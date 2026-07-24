import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/messages/:channelId
router.get("/:channelId", requireAuth, async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        edited_at,
        reply_to_message_id,
        read_at,
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
    
    if (!messages || messages.length === 0) {
      return res.json([]);
    }

    // Get all message IDs for attachments
    const messageIds = messages.map((m) => m.id);
    
    // Fetch attachments
    const { data: attachments, error: attError } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .in("message_id", messageIds);

    if (attError) {
      console.error("Attachment error:", attError);
      return res.status(500).json({ error: attError.message });
    }

    // Group attachments by message_id
    const attachmentsByMessageId = (attachments || []).reduce((acc, att) => {
      if (!acc[att.message_id]) acc[att.message_id] = [];
      acc[att.message_id].push(att);
      return acc;
    }, {});

    // Get reply message data
    const replyIds = messages
      .filter(m => m.reply_to_message_id)
      .map(m => m.reply_to_message_id);

    let replyMessages = [];
    if (replyIds.length > 0) {
      const { data: replies } = await supabase
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
        .in("id", replyIds);
      
      replyMessages = replies || [];
    }

    const replyMap = replyMessages.reduce((acc, reply) => {
      acc[reply.id] = reply;
      return acc;
    }, {});

    // Build final response
    const result = messages.map((m) => ({
      ...m,
      attachments: attachmentsByMessageId[m.id] || [],
      reply_to_message: m.reply_to_message_id ? replyMap[m.reply_to_message_id] || null : null
    }));

    // Reverse to get chronological order (oldest first)
    res.json(result.reverse());
  } catch (err) {
    console.error("Route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST - Send message
router.post("/:channelId", requireAuth, async (req, res) => {
  try {
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    const attachmentsData = req.body.attachments || [];
    const replyToMessageId = req.body.reply_to_message_id || null;

    // Insert message
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

    // Insert attachments if any
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
      }
    }

    // Fetch the complete message with sender info
    const { data: createdMsg, error: fetchError } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        created_at,
        edited_at,
        reply_to_message_id,
        read_at,
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

    // Get attachments for the message
    const { data: createdAttachments } = await supabase
      .from("attachments")
      .select("id, message_id, message_type, url, file_type, file_name")
      .eq("message_id", message.id);

    // Get reply to message data if it exists
    let replyToMessage = null;
    if (replyToMessageId) {
      const { data: replyData } = await supabase
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
      
      replyToMessage = replyData;
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

// ==================== READ RECEIPTS ROUTES (MUST COME BEFORE /:channelId/:messageId) ====================

// MARK CHANNEL MESSAGE AS READ
router.post("/:channelId/:messageId/read", requireAuth, async (req, res) => {
  try {
    const { channelId, messageId } = req.params;
    const userId = req.user.id;

    console.log(`📖 Marking message ${messageId} as read by user ${userId}`);

    // Check if already read
    const { data: existing, error: checkError } = await supabase
      .from("message_reads")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("message_type", "channel")
      .maybeSingle();

    if (checkError) {
      console.error("Check error:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (existing) {
      return res.json({ success: true, alreadyRead: true });
    }

    // Mark as read
    const { error: insertError } = await supabase
      .from("message_reads")
      .insert({
        message_id: messageId,
        message_type: "channel",
        user_id: userId,
        read_at: new Date().toISOString()
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return res.status(500).json({ error: insertError.message });
    }

    // Update the message's read_at field
    const { error: updateError } = await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("id", messageId);

    if (updateError) {
      console.error("Update error:", updateError);
    }

    console.log(`✅ Message ${messageId} marked as read`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking message as read:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET READ STATUS FOR A MESSAGE
router.get("/:channelId/:messageId/read-status", requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: reads, error } = await supabase
      .from("message_reads")
      .select(`
        user_id,
        read_at,
        profiles:user_id (
          id,
          full_name,
          username
        )
      `)
      .eq("message_id", messageId)
      .eq("message_type", "channel");

    if (error) {
      console.error("Read status error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.json({
      readCount: reads?.length || 0,
      readers: reads || []
    });
  } catch (err) {
    console.error("Error getting read status:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== MESSAGE CRUD ROUTES ====================

// PATCH - Edit message
router.patch("/:channelId/:messageId", requireAuth, async (req, res) => {
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: "Content is required" });
  }

  const { data, error } = await supabase
    .from("messages")
    .update({
      content: content.trim(),
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

// DELETE - Delete message
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

// POST - Add reaction
router.post("/:channelId/:messageId/react", requireAuth, async (req, res) => {
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({ error: "Emoji is required" });
  }

  // Check if reaction exists
  const { data: existing } = await supabase
    .from("reactions")
    .select("id")
    .eq("message_id", req.params.messageId)
    .eq("user_id", req.user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    // Remove reaction
    await supabase.from("reactions").delete().eq("id", existing.id);
    return res.json({ removed: true });
  }

  // Add reaction
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