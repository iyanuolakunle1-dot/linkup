import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/messages/:channelId - fetch message history (paginated)
router.get("/:channelId", requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before;

  let query = supabase
    .from("messages")
    .select(`
      id, content, created_at, edited_at,
      sender:profiles!messages_sender_id_fkey (id, username, full_name, avatar_color)
    `)
    .eq("channel_id", req.params.channelId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("created_at", before);

  const { data: messages, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const messageIds = messages.map((m) => m.id);
  let reactions = [];
  let attachments = [];

  if (messageIds.length > 0) {
    const [{ data: reactionData }, { data: attachmentData }] = await Promise.all([
      supabase.from("reactions").select("id, emoji, user_id, message_id")
        .eq("message_type", "channel").in("message_id", messageIds),
      supabase.from("attachments").select("id, url, file_type, file_name, message_id")
        .eq("message_type", "channel").in("message_id", messageIds),
    ]);
    reactions = reactionData || [];
    attachments = attachmentData || [];
  }

  const enriched = messages.map((m) => ({
    ...m,
    reactions: reactions.filter((r) => r.message_id === m.id),
    attachments: attachments.filter((a) => a.message_id === m.id),
  }));

  res.json(enriched.reverse());
});
// POST /api/messages/:channelId - send a message
router.post("/:channelId", requireAuth, async (req, res) => {
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  const { data, error } = await supabase
    .from("messages")
    .insert({
      channel_id: req.params.channelId,
      sender_id: req.user.id,
      content,
    })
    .select(`
      id, content, created_at,
      sender:profiles!messages_sender_id_fkey (id, username, full_name, avatar_color)
    `)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
// PATCH /api/messages/:channelId/:messageId - edit own message
router.patch("/:channelId/:messageId", requireAuth, async (req, res) => {
  const { content } = req.body;

  const { data, error } = await supabase
    .from("messages")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", req.params.messageId)
    .eq("sender_id", req.user.id) // can only edit own messages
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(403).json({ error: "Not allowed" });
  res.json(data);
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
// DELETE /api/messages/:channelId/:messageId
router.delete("/:channelId/:messageId", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", req.params.messageId)
    .eq("sender_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/messages/:channelId/:messageId/react - toggle a reaction
router.post("/:channelId/:messageId/react", requireAuth, async (req, res) => {
  const { emoji } = req.body;
  const { messageId } = req.params;

  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", req.user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from("reactions").delete().eq("id", existing.id);
    return res.json({ removed: true });
  }

  const { data, error } = await supabase
    .from("reactions")
    .insert({
      message_id: messageId,
      message_type: "channel",
      user_id: req.user.id,
      emoji,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default router;