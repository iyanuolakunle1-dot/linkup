import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/messages/:channelId
router.get("/:channelId", requireAuth, async (req, res) => {
  try {
    // 1. Fetch messages with reply_to_message_id
    const { data: messages, error } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        edited_at,
        reply_to_message_id,
        sender:profiles!messages_sender_id_fkey (
          id,
          username,
          full_name,
          avatar_color,
          avatar_url
        )
      `)
      .eq("channel_id", req.params.channelId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: error.message });
    }
    
    if (!messages || messages.length === 0) return res.json([]);

    // 2. Fetch attachments separately using message IDs
    const messageIds = messages.map((m) => m.id);
    const { data: attachments, error: attError } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .in("message_id", messageIds);

    if (attError) {
      console.error("Attachment error:", attError);
      return res.status(500).json({ error: attError.message });
    }

    // 3. Map attachments back to their respective messages
    const attachmentsByMessageId = (attachments || []).reduce((acc, att) => {
      if (!acc[att.message_id]) acc[att.message_id] = [];
      acc[att.message_id].push(att);
      return acc;
    }, {});

    // 4. Fetch reply_to_message data for messages that have it
    const replyMessageIds = messages
      .filter(m => m.reply_to_message_id)
      .map(m => m.reply_to_message_id);

    let replyMessages = [];
    if (replyMessageIds.length > 0) {
      const { data: replies, error: replyError } = await supabase
        .from("messages")
        .select(`
          id,
          content,
          sender:profiles!messages_sender_id_fkey (
            id,
            username,
            full_name,
            avatar_color,
            avatar_url
          )
        `)
        .in("id", replyMessageIds);

      if (!replyError) {
        replyMessages = replies || [];
      }
    }

    // 5. Map reply messages by ID
    const replyMessagesById = replyMessages.reduce((acc, reply) => {
      acc[reply.id] = reply;
      return acc;
    }, {});

    // 6. Build final result with reply_to_message data
    const result = messages.map((m) => ({
      ...m,
      attachments: attachmentsByMessageId[m.id] || [],
      reply_to_message: m.reply_to_message_id ? replyMessagesById[m.reply_to_message_id] || null : null
    }));

    res.json(result.reverse());
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// SEND CHANNEL MESSAGE
router.post("/:channelId", requireAuth, async (req, res) => {
  try {
    const content =
      typeof req.body.content === "string"
        ? req.body.content.trim()
        : "";

    const attachmentsData = req.body.attachments || [];
    const replyToMessageId = req.body.reply_to_message_id || null;

    // 1. Insert the message with reply_to_message_id
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .insert({
        channel_id: req.params.channelId,
        sender_id: req.user.id,
        content,
        reply_to_message_id: replyToMessageId
      })
      .select()
      .single();

    if (messageError) {
      console.error("Message insert error:", messageError);
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
        console.error("Attachment insert error:", attError);
        return res.status(500).json({ error: attError.message });
      }
    }

    // 3. Fetch the newly created message with profile and attachments
    const { data: createdMsg, error: fetchError } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        edited_at,
        reply_to_message_id,
        sender:profiles!messages_sender_id_fkey (
          id,
          username,
          full_name,
          avatar_color,
          avatar_url
        )
      `)
      .eq("id", message.id)
      .single();

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      return res.status(500).json({ error: fetchError.message });
    }

    const { data: createdAttachments } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .eq("message_id", message.id);

    // 4. Fetch reply_to_message data if it exists
    let replyToMessage = null;
    if (replyToMessageId) {
      const { data: replyData, error: replyError } = await supabase
        .from("messages")
        .select(`
          id,
          content,
          sender:profiles!messages_sender_id_fkey (
            id,
            username,
            full_name,
            avatar_color,
            avatar_url
          )
        `)
        .eq("id", replyToMessageId)
        .single();

      if (!replyError) {
        replyToMessage = replyData;
      }
    }

    return res.status(201).json({
      ...createdMsg,
      attachments: createdAttachments || [],
      reply_to_message: replyToMessage
    });
  } catch (err) {
    console.error("Route error:", err);
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
    console.error("Edit error:", error);
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
    console.error("Delete error:", error);
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
    console.error("Reaction error:", error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

export default router;