import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// GET /api/dm/threads
router.get("/threads", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("dm_threads")
    .select(`
      id, created_at,
      user_one, user_two, user_one_last_read_at, user_two_last_read_at,
      profiles_one:profiles!dm_threads_user_one_fkey (id, username, full_name, avatar_color, status),
      profiles_two:profiles!dm_threads_user_two_fkey (id, username, full_name, avatar_color, status)
    `)
    .or(`user_one.eq.${req.user.id},user_two.eq.${req.user.id}`);

  if (error) return res.status(500).json({ error: error.message });

  const threads = await Promise.all(
    (data || []).map(async (thread) => {
      const isUserOne = thread.user_one === req.user.id;
      const otherUser = isUserOne ? thread.profiles_two : thread.profiles_one;
      const lastRead = isUserOne ? thread.user_one_last_read_at : thread.user_two_last_read_at;

      const { data: lastMessage } = await supabase
        .from("dm_messages")
        .select("content, created_at, sender_id")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", thread.id)
        .neq("sender_id", req.user.id)
        .gt("created_at", lastRead || "1970-01-01");

      return {
        threadId: thread.id,
        otherUser,
        lastMessage: lastMessage || null,
        unreadCount: unreadCount || 0,
      };
    })
  );

  threads.sort((a, b) => {
    const aTime = a.lastMessage?.created_at || 0;
    const bTime = b.lastMessage?.created_at || 0;
    return new Date(bTime) - new Date(aTime);
  });

  res.json(threads);
});

// POST /api/dm/threads/:userId - get or create a thread
router.post("/threads/:userId", requireAuth, async (req, res) => {
  const [user_one, user_two] = orderPair(req.user.id, req.params.userId);

  const { data: existing, error: findError } = await supabase
    .from("dm_threads")
    .select("id")
    .eq("user_one", user_one)
    .eq("user_two", user_two)
    .maybeSingle();

  if (findError) return res.status(500).json({ error: findError.message });
  if (existing) return res.json({ threadId: existing.id });

  const { data, error } = await supabase
    .from("dm_threads")
    .insert({ user_one, user_two })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ threadId: data.id });
});

// PATCH /api/dm/threads/:threadId/read
router.patch("/threads/:threadId/read", requireAuth, async (req, res) => {
  const { data: thread, error } = await supabase
    .from("dm_threads")
    .select("user_one, user_two")
    .eq("id", req.params.threadId)
    .single();

  if (error || !thread) return res.status(404).json({ error: "Thread not found" });

  const column = thread.user_one === req.user.id ? "user_one_last_read_at" : "user_two_last_read_at";

  const { error: updateError } = await supabase
    .from("dm_threads")
    .update({ [column]: new Date().toISOString() })
    .eq("id", req.params.threadId);

  if (updateError) return res.status(500).json({ error: updateError.message });
  res.json({ success: true });
});

// GET /api/dm/threads/:threadId/messages
router.get("/threads/:threadId/messages", requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;

  const { data: messages, error } = await supabase
    .from("dm_messages")
    .select(`
      id, content, created_at, read_at, edited_at,
      sender:profiles!dm_messages_sender_id_fkey (
        id, 
        username, 
        full_name, 
        avatar_color,
        avatar_url
      )
    `)
    .eq("thread_id", req.params.threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("DM messages error:", error);
    return res.status(500).json({ error: error.message });
  }
  
  if (!messages || messages.length === 0) return res.json([]);

  const messageIds = messages.map((m) => m.id);
  const { data: attachments, error: attError } = await supabase
    .from("attachments")
    .select("id, message_id, message_type, url, file_type, file_name")
    .eq("message_type", "dm")
    .in("message_id", messageIds);

  if (attError) {
    console.error("Attachment error:", attError);
    return res.status(500).json({ error: attError.message });
  }

  const attachmentsByMessageId = (attachments || []).reduce((acc, att) => {
    if (!acc[att.message_id]) acc[att.message_id] = [];
    acc[att.message_id].push(att);
    return acc;
  }, {});

  const result = messages.map((m) => ({
    ...m,
    attachments: attachmentsByMessageId[m.id] || [],
  }));

  res.json(result.reverse());
});

// POST /api/dm/threads/:threadId/messages
router.post("/threads/:threadId/messages", requireAuth, async (req, res) => {
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  const { data: message, error } = await supabase
    .from("dm_messages")
    .insert({
      thread_id: req.params.threadId,
      sender_id: req.user.id,
      content,
    })
    .select(`
      id, content, created_at,
      sender:profiles!dm_messages_sender_id_fkey (id, username, full_name, avatar_color)
    `)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Attach empty array so the frontend immediately has an attachments property available
  res.status(201).json({ ...message, attachments: [] });
});

// PATCH /api/dm/threads/:threadId/messages/:messageId
router.patch("/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  if (!content) {
    return res.status(400).json({ error: "Message content is required" });
  }

  const { data, error } = await supabase
    .from("dm_messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", req.params.messageId)
    .eq("thread_id", req.params.threadId)
    .eq("sender_id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(403).json({ error: "Not allowed" });
  res.json(data);
});

// DELETE /api/dm/threads/:threadId/messages/:messageId
router.delete("/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("dm_messages")
    .delete()
    .eq("id", req.params.messageId)
    .eq("thread_id", req.params.threadId)
    .eq("sender_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;