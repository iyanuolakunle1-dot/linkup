import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// GET /api/dm/threads - list all DM threads for current user, with last message + unread count
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
    data.map(async (t) => {
      const isUserOne = t.user_one === req.user.id;
      const otherUser = isUserOne ? t.profiles_two : t.profiles_one;
      const myLastReadAt = isUserOne ? t.user_one_last_read_at : t.user_two_last_read_at;

      const { data: lastMsg } = await supabase
        .from("dm_messages")
        .select("content, created_at, sender_id")
        .eq("thread_id", t.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", t.id)
        .neq("sender_id", req.user.id)
        .gt("created_at", myLastReadAt);

      return {
        threadId: t.id,
        otherUser,
        lastMessage: lastMsg || null,
        unreadCount: unreadCount || 0,
      };
    })
  );

  // newest activity first
  threads.sort((a, b) => {
    const aTime = a.lastMessage?.created_at || 0;
    const bTime = b.lastMessage?.created_at || 0;
    return new Date(bTime) - new Date(aTime);
  });

  res.json(threads);
});

// POST /api/dm/threads/:userId - get or create a thread with another user
router.post("/threads/:userId", requireAuth, async (req, res) => {
  const [user_one, user_two] = orderPair(req.user.id, req.params.userId);

  const { data: existing } = await supabase
    .from("dm_threads")
    .select("id")
    .eq("user_one", user_one)
    .eq("user_two", user_two)
    .maybeSingle();

  if (existing) return res.json({ threadId: existing.id });

  const { data, error } = await supabase
    .from("dm_threads")
    .insert({ user_one, user_two })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ threadId: data.id });
});

// PATCH /api/dm/threads/:threadId/read - mark thread as read for current user
router.patch("/threads/:threadId/read", requireAuth, async (req, res) => {
  const { data: thread, error: fetchErr } = await supabase
    .from("dm_threads")
    .select("user_one, user_two")
    .eq("id", req.params.threadId)
    .single();

  if (fetchErr || !thread) return res.status(404).json({ error: "Thread not found" });

  const isUserOne = thread.user_one === req.user.id;
  const column = isUserOne ? "user_one_last_read_at" : "user_two_last_read_at";

  const { error } = await supabase
    .from("dm_threads")
    .update({ [column]: new Date().toISOString() })
    .eq("id", req.params.threadId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/dm/threads/:threadId/messages - fetch DM history
router.get("/threads/:threadId/messages", requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;

  const { data: messages, error } = await supabase
    .from("dm_messages")
    .select(`
      id, content, created_at, read_at, edited_at,
      sender:profiles!dm_messages_sender_id_fkey (id, username, full_name, avatar_color)
    `)
    .eq("thread_id", req.params.threadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const messageIds = messages.map((m) => m.id);
  let attachments = [];

  if (messageIds.length > 0) {
    const { data } = await supabase
      .from("attachments")
      .select("id, url, file_type, file_name, message_id")
      .eq("message_type", "dm")
      .in("message_id", messageIds);
    attachments = data || [];
  }

  const enriched = messages.map((m) => ({
    ...m,
    attachments: attachments.filter((a) => a.message_id === m.id),
  }));

  res.json(enriched.reverse());
});

// POST /api/dm/threads/:threadId/messages - send a DM
router.post("/threads/:threadId/messages", requireAuth, async (req, res) => {
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  const { data, error } = await supabase
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
  res.status(201).json(data);
});

// PATCH /api/dm/threads/:threadId/messages/:messageId - edit own DM
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

// DELETE /api/dm/threads/:threadId/messages/:messageId - delete own DM
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