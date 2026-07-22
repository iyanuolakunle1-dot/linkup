import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/channels - list public channels
router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/channels/:slug - get a single channel by slug (e.g. "general")
router.get("/:slug", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("slug", req.params.slug)
    .single();

  if (error) return res.status(404).json({ error: "Channel not found" });
  res.json(data);
});

// GET /api/channels/:id/members - list members of a channel
router.get("/:id/members", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("channel_members")
    .select("user_id, joined_at, profiles(username, full_name, avatar_color, status)")
    .eq("channel_id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/channels/:id/join - join a channel
router.post("/:id/join", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("channel_members")
    .upsert({ channel_id: req.params.id, user_id: req.user.id });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

export default router;