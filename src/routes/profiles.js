import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/profiles - list all profiles (for "Online Users" panel)
router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_color, role, bio, status")
    .order("status", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/profiles/me - current user's profile
router.get("/me", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/profiles/:id - single profile
router.get("/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_color, role, bio, status")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Profile not found" });
  res.json(data);
});

// PATCH /api/profiles/me - update own profile
router.patch("/me", requireAuth, async (req, res) => {
  const { full_name, bio, role, avatar_color } = req.body;

  const { data, error } = await supabase
    .from("profiles")
    .update({
      ...(full_name && { full_name }),
      ...(bio !== undefined && { bio }),
      ...(role !== undefined && { role }),
      ...(avatar_color && { avatar_color }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/profiles/me/status - update online/away/offline
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