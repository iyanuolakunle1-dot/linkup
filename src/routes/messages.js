import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();


// GET CHANNEL MESSAGES
// /api/messages/:channelId
router.get("/:channelId", requireAuth, async (req, res) => {

  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before;

  let query = supabase
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
    .eq("channel_id", req.params.channelId)
    .order("created_at", { ascending: false })
    .limit(limit);


  if (before) {
    query = query.lt("created_at", before);
  }


  const { data: messages, error } = await query;


  if(error){
    return res.status(500).json({
      error:error.message
    });
  }


  res.json(messages.reverse());

});




// SEND CHANNEL MESSAGE
// /api/messages/:channelId
router.post("/:channelId", requireAuth, async(req,res)=>{

  const content =
    typeof req.body.content === "string"
    ? req.body.content.trim()
    : "";


  const {data,error}=await supabase
    .from("messages")
    .insert({
      channel_id:req.params.channelId,
      sender_id:req.user.id,
      content
    })
    .select(`
      id,
      content,
      created_at,
      sender:profiles!messages_sender_id_fkey (
        id,
        username,
        full_name,
        avatar_color
      )
    `)
    .single();


  if(error){
    return res.status(500).json({
      error:error.message
    });
  }


  res.status(201).json(data);

});




// EDIT CHANNEL MESSAGE
// /api/messages/:channelId/:messageId
router.patch("/:channelId/:messageId", requireAuth, async(req,res)=>{


  const {content}=req.body;


  const {data,error}=await supabase
    .from("messages")
    .update({
      content,
      edited_at:new Date().toISOString()
    })
    .eq("id",req.params.messageId)
    .eq("sender_id",req.user.id)
    .select()
    .single();



  if(error){
    return res.status(500).json({
      error:error.message
    });
  }


  if(!data){
    return res.status(403).json({
      error:"Not allowed"
    });
  }


  res.json(data);

});




// DELETE CHANNEL MESSAGE
// /api/messages/:channelId/:messageId
router.delete("/:channelId/:messageId", requireAuth, async(req,res)=>{


  const {error}=await supabase
    .from("messages")
    .delete()
    .eq("id",req.params.messageId)
    .eq("sender_id",req.user.id);



  if(error){
    return res.status(500).json({
      error:error.message
    });
  }


  res.json({
    success:true
  });

});




// REACTION
// /api/messages/:channelId/:messageId/react
router.post("/:channelId/:messageId/react", requireAuth, async(req,res)=>{


  const {emoji}=req.body;


  const {data:existing}=await supabase
    .from("reactions")
    .select("id")
    .eq("message_id",req.params.messageId)
    .eq("user_id",req.user.id)
    .eq("emoji",emoji)
    .maybeSingle();



  if(existing){

    await supabase
      .from("reactions")
      .delete()
      .eq("id",existing.id);


    return res.json({
      removed:true
    });

  }



  const {data,error}=await supabase
    .from("reactions")
    .insert({
      message_id:req.params.messageId,
      message_type:"channel",
      user_id:req.user.id,
      emoji
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



export default router;