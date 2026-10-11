const OWNER=process.env.GITHUB_OWNER;
const REPO=process.env.GITHUB_REPO;
const TOKEN=process.env.GITHUB_TOKEN;
const PATH='notes.json';

function ghHeaders(){return{'Authorization':`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');}
function cleanPage(p){
  if(!p||typeof p!=='object')return null;
  const id=String(p.id||'').trim();
  const title=String(p.title||'').slice(0,300);
  if(!id||id.length>120)return null;
  const body=String(p.body||'');
  if(body.length>500000)return null;
  let blocks=Array.isArray(p.blocks)?p.blocks:[];
  if(blocks.length>1000)return null;
  blocks=blocks.map(b=>b&&b.type==='image'?{id:String(b.id||''),type:'image',name:String(b.name||''),url:b.url?String(b.url):undefined,data:b.data?String(b.data):undefined,created:b.created||undefined}:{id:String(b?.id||''),type:'text',text:String(b?.text||'')});
  const now=Date.now();
  return{id,title,body,blocks,created:Number(p.created)||now,updated:Number(p.updated)||now};
}

module.exports=async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!OWNER||!REPO||!TOKEN)return res.status(500).json({error:'Server environment is not configured'});
  try{
    const incoming=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const page=cleanPage(incoming?.page||incoming);
    if(!page)return res.status(400).json({error:'Invalid page payload'});
    const url=`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
    const read=await fetch(url,{headers:ghHeaders()});
    if(!read.ok)return res.status(502).json({error:'Unable to read notes storage'});
    const file=await read.json();
    const notes=JSON.parse(Buffer.from(file.content.replace(/\n/g,''),'base64').toString('utf8'));
    if(!Array.isArray(notes.pages))notes.pages=[];
    const i=notes.pages.findIndex(x=>x&&x.id===page.id);
    if(i>=0){page.created=Number(notes.pages[i].created)||page.created;notes.pages[i]=page;}else notes.pages.push(page);
    notes.version=1;
    notes.current=page.id;
    notes.updatedAt=new Date().toISOString();
    const write=await fetch(url,{method:'PUT',headers:ghHeaders(),body:JSON.stringify({message:i>=0?`Update note: ${page.title||page.id}`:`Add note: ${page.title||page.id}`,content:Buffer.from(JSON.stringify(notes,null,2)).toString('base64'),sha:file.sha})});
    if(!write.ok)return res.status(write.status===409?409:502).json({error:write.status===409?'Notes changed concurrently; retry':'Unable to write notes storage'});
    return res.status(i>=0?200:201).json({ok:true,action:i>=0?'updated':'created',page});
  }catch(e){console.error(e);return res.status(500).json({error:'Note update failed'});}
};
