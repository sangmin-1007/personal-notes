const OWNER=process.env.GITHUB_OWNER;
const REPO=process.env.GITHUB_REPO;
const TOKEN=process.env.GITHUB_TOKEN;
const API_KEY=process.env.NOTES_API_KEY;
const NOTES_DIR='notes';

function ghHeaders(){return{'Authorization':`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Notes-Key');res.setHeader('Cache-Control','no-store');}
function authorized(req){
  if(!API_KEY)return false;
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const key=String(req.headers['x-notes-key']||'');
  return bearer===API_KEY||key===API_KEY;
}
function cleanPage(p){
  if(!p||typeof p!=='object')return null;
  const id=String(p.id||'').trim();
  const title=String(p.title||'').slice(0,300);
  if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))return null;
  const body=String(p.body||'');
  if(body.length>500000)return null;
  let blocks=Array.isArray(p.blocks)?p.blocks:[];
  if(blocks.length>1000)return null;
  blocks=blocks.map(b=>b&&b.type==='image'?{id:String(b.id||''),type:'image',name:String(b.name||''),url:b.url?String(b.url):undefined,data:b.data?String(b.data):undefined,created:b.created||undefined}:{id:String(b?.id||''),type:'text',text:String(b?.text||'')});
  const now=Date.now();
  return{version:1,id,title,body,blocks,created:Number(p.created)||now,updated:now};
}
async function readFile(path){
  const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,{headers:ghHeaders()});
  if(r.status===404)return null;
  if(!r.ok)throw new Error('GitHub read failed');
  return r.json();
}

module.exports=async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!OWNER||!REPO||!TOKEN||!API_KEY)return res.status(500).json({error:'Server environment is not configured'});
  if(!authorized(req))return res.status(401).json({error:'Unauthorized'});
  try{
    const incoming=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const page=cleanPage(incoming?.page||incoming);
    if(!page)return res.status(400).json({error:'Invalid page payload'});
    const path=`${NOTES_DIR}/${page.id}.json`;
    const existing=await readFile(path);
    if(existing){
      const old=JSON.parse(Buffer.from(existing.content.replace(/\n/g,''),'base64').toString('utf8'));
      page.created=Number(old.created)||page.created;
    }
    const payload={message:existing?`Update note: ${page.title||page.id}`:`Add note: ${page.title||page.id}`,content:Buffer.from(JSON.stringify(page,null,2)).toString('base64')};
    if(existing)payload.sha=existing.sha;
    const write=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,{method:'PUT',headers:ghHeaders(),body:JSON.stringify(payload)});
    if(!write.ok)return res.status(write.status===409?409:502).json({error:write.status===409?'Note changed concurrently; retry':'Unable to write note'});
    return res.status(existing?200:201).json({ok:true,action:existing?'updated':'created',page});
  }catch(e){console.error(e);return res.status(500).json({error:'Note update failed'});}
};
