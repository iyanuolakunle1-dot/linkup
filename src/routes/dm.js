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
      id,
      created_at,
      user_one,
      user_two,
      user_one_last_read_at,
      user_two_last_read_at,

      profiles_one:profiles!dm_threads_user_one_fkey(
        id,
        username,
        full_name,
        avatar_color,
        status
      ),

      profiles_two:profiles!dm_threads_user_two_fkey(
        id,
        username,
        full_name,
        avatar_color,
        status
      )
    `)
    .or(`user_one.eq.${req.user.id},user_two.eq.${req.user.id}`);

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  const threads = await Promise.all(
    (data || []).map(async (thread) => {
      const isUserOne = thread.user_one === req.user.id;

      const otherUser = isUserOne
        ? thread.profiles_two
        : thread.profiles_one;

      const lastRead = isUserOne
        ? thread.user_one_last_read_at
        : thread.user_two_last_read_at;

      const { data: lastMessage } = await supabase
        .from("dm_messages")
        .select(`
          content,
          created_at,
          sender_id
        `)
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: unreadCount } = await supabase
        .from("dm_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", thread.id)
        .neq("sender_id", req.user.id)
        .gt(
          "created_at",
          lastRead || "1970-01-01"
        );

      return {
        threadId: thread.id,
        otherUser,
        lastMessage: lastMessage || null,
        unreadCount: unreadCount || 0
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

// CREATE OR GET DM THREAD
// POST /api/dm/threads/:userId
router.post("/threads/:userId", requireAuth, async (req, res) => {
  const [user_one, user_two] = orderPair(
    req.user.id,
    req.params.userId
  );

  const { data: existing, error: findError } = await supabase
    .from("dm_threads")
    .select("id")
    .eq("user_one", user_one)
    .eq("user_two", user_two)
    .maybeSingle();

  if (findError) {
    return res.status(500).json({
      error: findError.message
    });
  }

  if (existing) {
    return res.json({
      threadId: existing.id
    });
  }

  const { data, error } = await supabase
    .from("dm_threads")
    .insert({
      user_one,
      user_two
    })
    .select("id")
    .single();

  if (error) {
    return res.status(500).json({
      error: error.message
    });
  }

  res.status(201).json({
    threadId: data.id
  });
});

// MARK AS READ
// PATCH /api/dm/threads/:threadId/read
router.patch(
  "/threads/:threadId/read",
  requireAuth,
  async (req, res) => {
    const { data: thread, error } = await supabase
      .from("dm_threads")
      .select("user_one,user_two")
      .eq("id", req.params.threadId)
      .single();

    if (error || !thread) {
      return res.status(404).json({
        error: "Thread not found"
      });
    }

    const column =
      thread.user_one === req.user.id
        ? "user_one_last_read_at"
        : "user_two_last_read_at";

    const { error: updateError } = await supabase
      .from("dm_threads")
      .update({
        [column]: new Date().toISOString()
      })
      .eq("id", req.params.threadId);

    if (updateError) {
      return res.status(500).json({
        error: updateError.message
      });
    }

    res.json({
      success: true
    });
  }
);

// GET DM MESSAGES
// GET /api/dm/threads/:threadId/messages
router.get(
  "/threads/:threadId/messages",
  requireAuth,
  async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    const { data: messages, error } = await supabase
      .from("dm_messages")
      .select(`
        id,
        content,
        created_at,
        read_at,
        edited_at,

        sender:profiles!dm_messages_sender_id_fkey(
          id,
          username,
          full_name,
          avatar_color
        ),

        attachments(*)
      `)
      .eq("thread_id", req.params.threadId)
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(limit);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(
      (messages || []).reverse()
    );
  }
);

// SEND MESSAGE WITH ATTACHMENT SUPPORT
// POST /api/dm/threads/:threadId/messages
router.post(
  "/threads/:threadId/messages",
  requireAuth,
  async (req, res) => {
    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    const { file_url, file_type, file_name } = req.body;

    if (!content && !file_url) {
      return res.status(400).json({
        error: "Message required"
      });
    }

    const { data: messageData, error: messageError } = await supabase
      .from("dm_messages")
      .insert({
        thread_id: req.params.threadId,
        sender_id: req.user.id,
        content: content || (file_name ? `Sent an attachment: ${file_name}` : "")
      })
      .select(`
        id,
        content,
        created_at,
        sender:profiles!dm_messages_sender_id_fkey(
          id,
          username,
          full_name,
          avatar_color
        )
      `)
      .single();

    if (messageError) {
      return res.status(500).json({
        error: messageError.message
      });
    }

    if (file_url) {
      const { error: attError } = await supabase
        .from("attachments")
        .insert({
          message_id: messageData.id,
          url: file_url,
          file_type: file_type || "image/",
          file_name: file_name || "attachment"
        });

      if (attError) {
        console.error("Failed to save attachment metadata:", attError);
      }
    }

    const { data: finalMessage, error: fetchError } = await supabase
      .from("dm_messages")
      .select(`
        id,
        content,
        created_at,
        read_at,
        edited_at,
        sender:profiles!dm_messages_sender_id_fkey(
          id,
          username,
          full_name,
          avatar_color
        ),
        attachments(*)
      `)
      .eq("id", messageData.id)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    res.status(201).json(finalMessage);
  }
);

// EDIT MESSAGE
router.patch(
  "/threads/:threadId/messages/:messageId",
  requireAuth,
  async (req, res) => {
    const content = req.body.content?.trim();

    if (!content) {
      return res.status(400).json({
        error: "Message content required"
      });
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
      return res.status(500).json({
        error: error.message
      });
    }

    res.json(data);
  }
);

// DELETE MESSAGE
router.delete(
  "/threads/:threadId/messages/:messageId",
  requireAuth,
  async (req, res) => {
    const { error } = await supabase
      .from("dm_messages")
      .delete()
      .eq("id", req.params.messageId)
      .eq("thread_id", req.params.threadId)
      .eq("sender_id", req.user.id);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      success: true
    });
  }
);

export default router;