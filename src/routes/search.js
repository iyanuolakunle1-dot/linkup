import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/search?q=term - search users and messages
router.get("/", requireAuth, async (req, res) => {
  const q = (req.query.q || "").trim();

  if (q.length < 2) {
    return res.json({ users: [], channelMessages: [], dmMessages: [] });
  }

  // 1. Search users by name or username
  const { data: users, error: userErr } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_color, status")
    .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
    .neq("id", req.user.id)
    .limit(8);

  if (userErr) return res.status(500).json({ error: userErr.message });

  // 2. Search channel messages (public, so any authenticated user can search all of them)
  const { data: channelMessages, error: chErr } = await supabase
    .from("messages")
    .select(`
      id, content, created_at, channel_id,
      sender:profiles!messages_sender_id_fkey (id, full_name, avatar_color)
    `)
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(10);

  if (chErr) return res.status(500).json({ error: chErr.message });

  // 3. Search DM messages, but only within threads the current user belongs to
  const { data: myThreads } = await supabase
    .from("dm_threads")
    .select("id")
    .or(`user_one.eq.${req.user.id},user_two.eq.${req.user.id}`);

  const threadIds = (myThreads || []).map((t) => t.id);

  let dmMessages = [];
  if (threadIds.length > 0) {
    const { data: dmData, error: dmErr } = await supabase
      .from("dm_messages")
      .select(`
        id, content, created_at, thread_id,
        sender:profiles!dm_messages_sender_id_fkey (id, full_name, avatar_color)
      `)
      .ilike("content", `%${q}%`)
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false })
      .limit(10);

    if (dmErr) return res.status(500).json({ error: dmErr.message });
    dmMessages = dmData || [];
  }

  res.json({ users: users || [], channelMessages: channelMessages || [], dmMessages });
});

export default router;