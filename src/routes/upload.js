import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function handleUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }

  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const file = req.file;
  const isImage = file.mimetype.startsWith("image/");
  const isAudio = file.mimetype.startsWith("audio/");
  const isVideo = file.mimetype.startsWith("video/");
  
  // Choose safe resource type
  let resourceType = "auto";
  if (isImage) resourceType = "image";
  else if (isAudio || isVideo) resourceType = "video";
  else resourceType = "raw"; // Safely handle docs, pdfs, zips, etc.

  try {
    const result = await uploadBufferToCloudinary(
      file.buffer,
      {
        folder: `chat-app/${req.user.id}`,
        resource_type: resourceType,
        public_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    );

    return res.status(201).json({
      url: result.secure_url,
      fileName: file.originalname,
      fileType: file.mimetype,
      cloudinaryPublicId: result.public_id
    });
  } catch (err) {
    console.error("Cloudinary upload failed:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
}

// Handle both / and empty string to prevent 404 trailing slash errors
router.post("/", requireAuth, upload.single("file"), handleUpload);
router.post("", requireAuth, upload.single("file"), handleUpload);

router.post("/attach", requireAuth, async (req, res) => {
  try {
    const { message_id, message_type, url, file_type, file_name } = req.body;

    const { data, error } = await supabase
      .from("attachments")
      .insert([
        {
          message_id,
          message_type: message_type || "channel",
          url,
          file_type,
          file_name,
        },
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/upload/:publicId
router.delete(
  "/:publicId(*)",
  requireAuth,
  async (req, res) => {
    try {
      await cloudinary.uploader.destroy(req.params.publicId);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;