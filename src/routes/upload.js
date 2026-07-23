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

  return new Promise((resolve, reject)=>{

    const stream = cloudinary.uploader.upload_stream(
      options,
      (error,result)=>{

        if(error){
          return reject(error);
        }

        resolve(result);

      }
    );


    stream.end(buffer);

  });

}




// POST /api/upload
router.post(
  "/",
  requireAuth,
  upload.single("file"),
  async (req,res)=>{


    if(!req.file){

      return res.status(400).json({
        error:"No file provided"
      });

    }



    const file = req.file;

    const isImage =
      file.mimetype.startsWith("image/");

    const isAudio =
      file.mimetype.startsWith("audio/");



    try{


      const result =
        await uploadBufferToCloudinary(
          file.buffer,
          {

            folder:`chat-app/${req.user.id}`,

            resource_type:
              isImage
              ? "image"
              : isAudio
              ? "video"
              : "auto",


            public_id:
              `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`

          }
        );



      res.status(201).json({

        url:result.secure_url,

        fileName:file.originalname,

        fileType:file.mimetype,

        cloudinaryPublicId:
          result.public_id

      });



    }catch(err){


      console.error(
        "Cloudinary upload failed:",
        err
      );


      res.status(500).json({
        error:"Upload failed"
      });


    }


});







// POST /api/upload/attach
router.post(
  "/attach",
  requireAuth,
  async(req,res)=>{


    const {
      message_id,
      message_type,
      url,
      file_type,
      file_name
    } = req.body;



    if(
      !message_id ||
      !message_type ||
      !url
    ){

      return res.status(400).json({

        error:
        "message_id, message_type, and url are required"

      });

    }




    const {
      data,
      error
    } = await supabase
      .from("attachments")
      .insert({

        message_id,

        message_type,

        url,

        file_type,

        file_name

      })
      .select()
      .single();




    if(error){

      return res.status(500).json({
        error:error.message
      });

    }



    res.status(201).json(data);


});







// DELETE /api/upload/:publicId
router.delete(
  "/:publicId(*)",
  requireAuth,
  async(req,res)=>{


    try{


      await cloudinary.uploader.destroy(
        req.params.publicId
      );


      res.json({
        success:true
      });



    }catch(err){


      res.status(500).json({
        error:err.message
      });


    }


});




export default router;