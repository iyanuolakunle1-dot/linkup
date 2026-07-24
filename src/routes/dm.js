import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

// ============================================
// DM THREAD ROUTES
// ============================================

// GET /api/dm/threads - Get all DM threads for current user
router.get("/threads", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("dm_threads")
      .select(`
        id, created_at,
        user_one, user_two, user_one_last_read_at, user_two_last_read_at,
        profiles_one:profiles!dm_threads_user_one_fkey (id, username, full_name, avatar_color, status, avatar_url),
        profiles_two:profiles!dm_threads_user_two_fkey (id, username, full_name, avatar_color, status, avatar_url)
      `)
      .or(`user_one.eq.${req.user.id},user_two.eq.${req.user.id}`);

    if (error) {
      console.error("Threads error:", error);
      return res.status(500).json({ error: error.message });
    }

    const threads = await Promise.all(
      (data || []).map(async (thread) => {
        const isUserOne = thread.user_one === req.user.id;
        const otherUser = isUserOne ? thread.profiles_two : thread.profiles_one;
        const lastRead = isUserOne ? thread.user_one_last_read_at : thread.user_two_last_read_at;

        const { data: lastMessage } = await supabase
          .from("dm_messages")
          .select("content, created_at, sender_id, id, read_at")
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
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/threads/:userId - Get or create a DM thread with another user
router.post("/threads/:userId", requireAuth, async (req, res) => {
  try {
    const [user_one, user_two] = orderPair(req.user.id, req.params.userId);

    // Check if thread already exists
    const { data: existing, error: findError } = await supabase
      .from("dm_threads")
      .select("id")
      .eq("user_one", user_one)
      .eq("user_two", user_two)
      .maybeSingle();

    if (findError) {
      console.error("Find thread error:", findError);
      return res.status(500).json({ error: findError.message });
    }

    if (existing) {
      return res.json({ threadId: existing.id });
    }

    // Create new thread
    const { data, error } = await supabase
      .from("dm_threads")
      .insert({ user_one, user_two })
      .select("id")
      .single();

    if (error) {
      console.error("Create thread error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ threadId: data.id });
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/dm/threads/:threadId/read - Mark thread as read
router.patch("/threads/:threadId/read", requireAuth, async (req, res) => {
  try {
    const { data: thread, error } = await supabase
      .from("dm_threads")
      .select("user_one, user_two")
      .eq("id", req.params.threadId)
      .single();

    if (error || !thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const column = thread.user_one === req.user.id ? "user_one_last_read_at" : "user_two_last_read_at";

    const { error: updateError } = await supabase
      .from("dm_threads")
      .update({ [column]: new Date().toISOString() })
      .eq("id", req.params.threadId);

    if (updateError) {
      console.error("Update thread read error:", updateError);
      return res.status(500).json({ error: updateError.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DM MESSAGE READ RECEIPT ROUTES
// ============================================

// MARK DM MESSAGE AS READ - FIXED VERSION
router.post("/messages/:messageId/read", requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    console.log(`📖 Marking DM message ${messageId} as read by user ${userId}`);

    // First, verify this message exists and belongs to a thread the user is in
    const { data: message, error: msgError } = await supabase
      .from("dm_messages")
      .select(`
        id,
        thread_id,
        sender_id,
        dm_threads!inner (
          user_one,
          user_two
        )
      `)
      .eq("id", messageId)
      .single();

    if (msgError || !message) {
      console.error("Message not found:", msgError);
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if user is part of this thread
    const thread = message.dm_threads;
    if (thread.user_one !== userId && thread.user_two !== userId) {
      return res.status(403).json({ error: "Not authorized to read this message" });
    }

    // Check if already read
    const { data: existing, error: checkError } = await supabase
      .from("message_reads")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("message_type", "dm")
      .maybeSingle();

    if (checkError) {
      console.error("Check error:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (existing) {
      return res.json({ success: true, alreadyRead: true });
    }

    // Mark as read - insert into message_reads
    const { error: insertError } = await supabase
      .from("message_reads")
      .insert({
        message_id: messageId,
        message_type: "dm",
        user_id: userId,
        read_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    // Update the dm_message's read_at field
    const { error: updateError } = await supabase
      .from("dm_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("id", messageId);

    if (updateError) {
      console.error("Update error:", updateError);
      // Don't fail the request
    }

    console.log(`✅ DM Message ${messageId} marked as read`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking DM as read:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DM MESSAGE ROUTES
// ============================================

// GET /api/dm/threads/:threadId/messages - Get messages for a thread
router.get("/threads/:threadId/messages", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // Verify user is part of this thread
    const { data: thread, error: threadError } = await supabase
      .from("dm_threads")
      .select("user_one, user_two")
      .eq("id", req.params.threadId)
      .single();

    if (threadError || !thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.user_one !== req.user.id && thread.user_two !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { data: messages, error } = await supabase
      .from("dm_messages")
      .select(`
        id, 
        content, 
        created_at, 
        read_at, 
        edited_at,
        reply_to_message_id,
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
    
    if (!messages || messages.length === 0) {
      return res.json([]);
    }

    // Get attachments
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

    // Get reply messages
    const replyIds = messages
      .filter(m => m.reply_to_message_id)
      .map(m => m.reply_to_message_id);

    let replyMessages = [];
    if (replyIds.length > 0) {
      const { data: replies } = await supabase
        .from("dm_messages")
        .select(`
          id,
          content,
          sender:profiles!dm_messages_sender_id_fkey (
            id,
            username,
            full_name,
            avatar_color,
            avatar_url
          )
        `)
        .in("id", replyIds);
      replyMessages = replies || [];
    }

    const replyMap = replyMessages.reduce((acc, reply) => {
      acc[reply.id] = reply;
      return acc;
    }, {});

    const attachmentsByMessageId = (attachments || []).reduce((acc, att) => {
      if (!acc[att.message_id]) acc[att.message_id] = [];
      acc[att.message_id].push(att);
      return acc;
    }, {});

    const result = messages.map((m) => ({
      ...m,
      attachments: attachmentsByMessageId[m.id] || [],
      reply_to_message: m.reply_to_message_id ? replyMap[m.reply_to_message_id] || null : null
    }));

    res.json(result.reverse());
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/threads/:threadId/messages - Send a message
router.post("/threads/:threadId/messages", requireAuth, async (req, res) => {
  try {
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    const replyToMessageId = req.body.reply_to_message_id || null;

    // Verify user is part of this thread
    const { data: thread, error: threadError } = await supabase
      .from("dm_threads")
      .select("user_one, user_two")
      .eq("id", req.params.threadId)
      .single();

    if (threadError || !thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (thread.user_one !== req.user.id && thread.user_two !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { data: message, error } = await supabase
      .from("dm_messages")
      .insert({
        thread_id: req.params.threadId,
        sender_id: req.user.id,
        content,
        reply_to_message_id: replyToMessageId
      })
      .select(`
        id, 
        content, 
        created_at, 
        read_at, 
        edited_at,
        reply_to_message_id,
        sender:profiles!dm_messages_sender_id_fkey (
          id, 
          username, 
          full_name, 
          avatar_color,
          avatar_url
        )
      `)
      .single();

    if (error) {
      console.error("Send message error:", error);
      return res.status(500).json({ error: error.message });
    }

    // Get reply message if exists
    let replyToMessage = null;
    if (replyToMessageId) {
      const { data: replyData } = await supabase
        .from("dm_messages")
        .select(`
          id,
          content,
          sender:profiles!dm_messages_sender_id_fkey (
            id,
            username,
            full_name,
            avatar_color,
            avatar_url
          )
        `)
        .eq("id", replyToMessageId)
        .single();
      replyToMessage = replyData;
    }

    res.status(201).json({
      ...message,
      attachments: [],
      reply_to_message: replyToMessage
    });
  } catch (err) {
    console.error("Route error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/dm/threads/:threadId/messages/:messageId - Edit a message
router.patch("/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
  try {
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

    if (!content) {
      return res.status(400).json({ error: "Message content is required" });
    }

    const { data, error } = await supabase
      .from("dm_messages")
      .update({ 
        content, 
        edited_at: new Date().toISOString() 
      })
      .eq("id", req.params.messageId)
      .eq("thread_id", req.params.threadId)
      .eq("sender_id", req.user.id)
      .select()
      .single();

    if (error) {
      console.error("Edit message error:", error);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(403).json({ error: "Not allowed" });
    }

    res.json(data);
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dm/threads/:threadId/messages/:messageId - Delete a message
router.delete("/threads/:threadId/messages/:messageId", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("dm_messages")
      .delete()
      .eq("id", req.params.messageId)
      .eq("thread_id", req.params.threadId)
      .eq("sender_id", req.user.id);

    if (error) {
      console.error("Delete message error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;