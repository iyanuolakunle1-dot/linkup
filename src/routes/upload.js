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

// AVATAR UPLOAD ROUTE
router.post("/avatar", requireAuth, upload.single("file"), async (req, res) => {
  try {
    console.log("Avatar upload request received");
    
    if (!req.file) {
      console.log("No file provided");
      return res.status(400).json({ error: "No file provided" });
    }

    console.log("File received:", req.file.originalname, req.file.mimetype);

    if (!req.user || !req.user.id) {
      console.log("No user found");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const file = req.file;
    if (!file.mimetype.startsWith("image/")) {
      console.log("Not an image file");
      return res.status(400).json({ error: "Only image files are allowed" });
    }

    if (file.size > 5 * 1024 * 1024) {
      console.log("File too large");
      return res.status(400).json({ error: "Image must be less than 5MB" });
    }

    console.log("Uploading to Cloudinary...");
    const result = await uploadBufferToCloudinary(
      file.buffer,
      {
        folder: `chat-app/avatars/${req.user.id}`,
        resource_type: "image",
        public_id: `avatar-${Date.now()}`,
        transformation: [
          { width: 300, height: 300, crop: "fill", gravity: "face" }
        ]
      }
    );

    console.log("Cloudinary upload successful:", result.secure_url);

    // Update user profile with avatar URL
    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: result.secure_url })
      .eq("id", req.user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return res.status(500).json({ error: "Failed to update profile" });
    }

    console.log("Profile updated successfully");

    return res.status(201).json({
      url: result.secure_url,
      publicId: result.public_id,
      profile: updatedProfile
    });
  } catch (err) {
    console.error("Avatar upload error:", err);
    return res.status(500).json({ 
      error: err.message || "Upload failed",
      details: err.stack 
    });
  }
});

// Regular file upload
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
  
  let resourceType = "auto";
  if (isImage) resourceType = "image";
  else if (isAudio || isVideo) resourceType = "video";
  else resourceType = "raw";

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

// Regular file upload routes
router.post("/", requireAuth, upload.single("file"), handleUpload);
router.post("", requireAuth, upload.single("file"), handleUpload);

// Attach file to message
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

// Delete upload
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