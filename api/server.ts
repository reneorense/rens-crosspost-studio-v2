import { supabaseAdmin } from './lib/supabaseAdmin';

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { action, ...payload } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'Missing action field in request body.' });
  }

  try {
    switch (action) {
      case 'getDashboardStats': {
        try {
          const { count: accountsCount, error: accErr } = await supabaseAdmin
            .from('connected_accounts')
            .select('*', { count: 'exact', head: true });

          const { count: livePostsCount, error: postsErr } = await supabaseAdmin
            .from('posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'posted');

          const { count: scheduledCount, error: schedErr } = await supabaseAdmin
            .from('scheduled_posts')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'scheduled');

          const { count: mediaCount, error: mediaErr } = await supabaseAdmin
            .from('media_assets')
            .select('*', { count: 'exact', head: true });

          if (accErr || postsErr || schedErr || mediaErr) {
            console.warn('[Supabase Admin] Error querying stats helper tables:', { accErr, postsErr, schedErr, mediaErr });
          }

          return res.status(200).json({
            success: true,
            data: {
              connectedAccountsCount: accountsCount || 0,
              livePostsCount: livePostsCount || 0,
              scheduledPostsCount: scheduledCount || 0,
              mediaAssetsCount: mediaCount || 0
            }
          });
        } catch (dbErr: any) {
          console.error('[Dashboard Stats] Database error:', dbErr);
          // Return zero states on error
          return res.status(200).json({
            success: true,
            data: {
              connectedAccountsCount: 0,
              livePostsCount: 0,
              scheduledPostsCount: 0,
              mediaAssetsCount: 0
            }
          });
        }
      }

      case 'getConnectedAccounts': {
        const { data, error } = await supabaseAdmin
          .from('connected_accounts')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        return res.status(200).json({ success: true, data: data || [] });
      }

      case 'getPosts': {
        const { data: postsData, error: postsErr } = await supabaseAdmin
          .from('posts')
          .select('*')
          .order('created_at', { ascending: false });

        if (postsErr) throw postsErr;

        const { data: schedData } = await supabaseAdmin
          .from('scheduled_posts')
          .select('*');

        const { data: targetData } = await supabaseAdmin
          .from('post_targets')
          .select('*');

        const decoratedPosts = (postsData || []).map((p: any) => {
          const schedule = (schedData || []).find((s: any) => s.post_id === p.id);
          const targets = (targetData || []).filter((t: any) => t.post_id === p.id);
          return {
            ...p,
            schedule,
            targets
          };
        });

        return res.status(200).json({ success: true, data: decoratedPosts });
      }

      case 'getScheduledPosts': {
        const { data, error } = await supabaseAdmin
          .from('scheduled_posts')
          .select('*')
          .order('scheduled_at', { ascending: true });

        if (error) throw error;
        return res.status(200).json({ success: true, data: data || [] });
      }

      case 'getMediaAssets': {
        const { data, error } = await supabaseAdmin
          .from('media_assets')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        return res.status(200).json({ success: true, data: data || [] });
      }

      case 'createPostDraft': {
        const { id, title, caption, media_asset_ids, status, scheduled_at, timezone } = payload;
        const finalId = id || `post_${Date.now()}`;
        
        // Upsert standard post record
        const { error: postErr } = await supabaseAdmin
          .from('posts')
          .upsert({
            id: finalId,
            title: title || '',
            caption: caption || '',
            media_asset_ids: media_asset_ids || [],
            status: status || 'draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (postErr) throw postErr;

        // If status is scheduled, upsert scheduled item
        if (status === 'scheduled' && scheduled_at) {
          const { error: schedErr } = await supabaseAdmin
            .from('scheduled_posts')
            .upsert({
              id: `sched_${finalId}`,
              post_id: finalId,
              scheduled_at: scheduled_at,
              timezone: timezone || 'UTC',
              status: 'scheduled',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });

          if (schedErr) throw schedErr;
        }

        return res.status(200).json({ success: true, id: finalId });
      }

      case 'createMediaUploadRecord': {
        const { id, file_url, file_type, file_name, file_size, mime_type } = payload;
        const finalId = id || `media_${Date.now()}`;

        const { error: mediaErr } = await supabaseAdmin
          .from('media_assets')
          .insert({
            id: finalId,
            file_url,
            file_type,
            file_name,
            file_size: file_size || 0,
            mime_type: mime_type || 'image/png',
            created_at: new Date().toISOString()
          });

        if (mediaErr) throw mediaErr;
        return res.status(200).json({ success: true, id: finalId });
      }

      case 'createSignedUploadUrl': {
        const { path } = payload;
        if (!path) {
          return res.status(400).json({ error: 'Missing path argument for storage uploading.' });
        }
        
        const bucketName = process.env.SUPABASE_MEDIA_BUCKET || 'media';
        const { data, error } = await supabaseAdmin.storage
          .from(bucketName)
          .createSignedUploadUrl(path);

        if (error) {
          // If the bucket doesn't exist or is not created yet, return error details gracefully
          return res.status(200).json({
            success: false,
            error: error.message,
            message: 'Please ensure Supabase storage bucket of name specified is created.'
          });
        }

        return res.status(200).json({ success: true, data });
      }

      case 'getLogs': {
        const { data, error } = await supabaseAdmin
          .from('post_logs')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        return res.status(200).json({ success: true, data: data || [] });
      }

      default:
        return res.status(400).json({ error: `Unknown action requested: ${action}` });
    }
  } catch (error: any) {
    console.error(`[API Handler Error] Action ${action} failed:`, error);
    return res.status(500).json({ error: error.message || 'Internal server transaction failed.' });
  }
}
