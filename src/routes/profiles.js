import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/profiles
router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_color, role, bio, status, avatar_url, created_at")
    .order("status", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// GET /api/profiles/me
router.get("/me", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// GET /api/profiles/:id
router.get("/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_color, role, bio, status, avatar_url, created_at")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Profile not found" });

  res.json(data);
});

// PATCH /api/profiles/me
router.patch("/me", requireAuth, async (req, res) => {
  const { full_name, bio, role, avatar_color, avatar_url, username } = req.body;

  const updateData = {
    ...(full_name !== undefined && { full_name }),
    ...(bio !== undefined && { bio }),
    ...(role !== undefined && { role }),
    ...(avatar_color !== undefined && { avatar_color }),
    ...(avatar_url !== undefined && { avatar_url }),
    ...(username !== undefined && { username }),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// PATCH /api/profiles/me/status
router.patch("/me/status", requireAuth, async (req, res) => {
  const { status } = req.body;

  if (!["online", "away", "offline"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

export default router;