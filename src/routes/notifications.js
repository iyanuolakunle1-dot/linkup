import express from "express";
import { supabase } from "../lib/supabaseClient.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();


// GET /api/notifications
router.get("/", requireAuth, async (req, res) => {

  const { data, error } = await supabase
    .from("notifications")
    .select(`
      id,
      type,
      thread_id,
      message_preview,
      read,
      created_at,

      actor:profiles!notifications_actor_id_fkey(
        id,
        full_name,
        avatar_color
      )
    `)
    .eq("user_id", req.user.id)
    .order("created_at", {
      ascending: false
    })
    .limit(30);


  if (error) {
    return res.status(500).json({
      error:error.message
    });
  }


  res.json(data || []);

});




// PATCH /api/notifications/:id/read
router.patch("/:id/read", requireAuth, async (req,res)=>{


  const {error}=await supabase
    .from("notifications")
    .update({
      read:true
    })
    .eq("id",req.params.id)
    .eq("user_id",req.user.id);



  if(error){

    return res.status(500).json({
      error:error.message
    });

  }



  res.json({
    success:true
  });


});






// PATCH /api/notifications/read-all
router.patch("/read-all", requireAuth, async(req,res)=>{


  const {error}=await supabase
    .from("notifications")
    .update({
      read:true
    })
    .eq("user_id",req.user.id)
    .eq("read",false);



  if(error){

    return res.status(500).json({
      error:error.message
    });

  }



  res.json({
    success:true
  });


});



export default router;