import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/:channelId", requireAuth, async (req, res) => {
  try {
    // 1. Fetch messages independently without any foreign table joins
// In the GET route, make sure to select avatar_url
const { data: messages, error } = await supabase
  .from("messages")
  .select(`
    id,
    content,
    created_at,
    edited_at,
    sender:profiles!messages_sender_id_fkey (
      id,
      username,
      full_name,
      avatar_color,
      avatar_url  // Make sure this is included
    )
  `)
  .eq("channel_id", req.params.channelId)
  .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    if (!messages || messages.length === 0) return res.json([]);

    // 2. Fetch attachments separately using message IDs
    const messageIds = messages.map((m) => m.id);
    const { data: attachments, error: attError } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .in("message_id", messageIds);

    if (attError) return res.status(500).json({ error: attError.message });

    // 3. Map attachments back to their respective messages safely in code
    const attachmentsByMessageId = (attachments || []).reduce((acc, att) => {
      if (!acc[att.message_id]) acc[att.message_id] = [];
      acc[att.message_id].push(att);
      return acc;
    }, {});

    const result = messages.map((m) => ({
      ...m,
      attachments: attachmentsByMessageId[m.id] || []
    }));

    res.json(result.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEND CHANNEL MESSAGE
// /api/messages/:channelId
router.post("/:channelId", requireAuth, async (req, res) => {
  try {
    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    const attachmentsData = req.body.attachments || [];

    // 1. Insert the message first
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .insert({
        channel_id: req.params.channelId,
        sender_id: req.user.id,
        content
      })
      .select()
      .single();

    if (messageError) {
      return res.status(500).json({ error: messageError.message });
    }

    // 2. Insert attachments if any exist
    if (attachmentsData.length > 0) {
      const formattedAttachments = attachmentsData.map((att) => ({
        message_id: message.id,
        message_type: att.message_type || "channel",
        url: att.url,
        file_type: att.file_type,
        file_name: att.file_name
      }));

      const { error: attError } = await supabase
        .from("attachments")
        .insert(formattedAttachments);

      if (attError) {
        return res.status(500).json({ error: attError.message });
      }
    }

    // 3. Fetch the newly created message with profile and attachments safely
    const { data: createdMsg, error: fetchError } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        edited_at,
        sender:profiles!messages_sender_id_fkey (
          id,
          username,
          full_name,
          avatar_color
        )
      `)
      .eq("id", message.id)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    const { data: createdAttachments } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .eq("message_id", message.id);

    return res.status(201).json({
      ...createdMsg,
      attachments: createdAttachments || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// EDIT CHANNEL MESSAGE
router.patch("/:channelId/:messageId", requireAuth, async (req, res) => {
  const { content } = req.body;

  const { data, error } = await supabase
    .from("messages")
    .update({
      content,
      edited_at: new Date().toISOString()
    })
    .eq("id", req.params.messageId)
    .eq("sender_id", req.user.id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(403).json({ error: "Not allowed" });
  }

  res.json(data);
});

// DELETE CHANNEL MESSAGE
router.delete("/:channelId/:messageId", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", req.params.messageId)
    .eq("sender_id", req.user.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

// REACTION
router.post("/:channelId/:messageId/react", requireAuth, async (req, res) => {
  const { emoji } = req.body;

  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("message_id", req.params.messageId)
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
      message_id: req.params.messageId,
      message_type: "channel",
      user_id: req.user.id,
      emoji
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

export default router;