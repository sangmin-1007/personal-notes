const OWNER=process.env.GITHUB_OWNER;
const REPO=process.env.GITHUB_REPO;
const TOKEN=process.env.GITHUB_TOKEN;
const PATH='notes.json';

function headers(){return{'Authorization':`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');}

module.exports=async(req,res)=>{
  cors(res);
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!OWNER||!REPO||!TOKEN)return res.status(500).json({error:'Server environment is not configured'});
  const url=`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
  try{
    const read=await fetch(url,{headers:headers()});
    if(!read.ok){const t=await read.text();return res.status(read.status).json({error:'GitHub read failed',detail:t});}
    const file=await read.json();
    const decoded=Buffer.from(file.content.replace(/\n/g,''),'base64').toString('utf8');
    if(req.method==='GET')return res.status(200).json(JSON.parse(decoded));
    if(req.method!=='PUT')return res.status(405).json({error:'Method not allowed'});
    const incoming=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!incoming||!Array.isArray(incoming.pages))return res.status(400).json({error:'Invalid notes payload'});
    const next={version:1,updatedAt:new Date().toISOString(),current:incoming.current||null,pages:incoming.pages};
    const write=await fetch(url,{method:'PUT',headers:headers(),body:JSON.stringify({message:'Sync notes from Personal Notes',content:Buffer.from(JSON.stringify(next,null,2)).toString('base64'),sha:file.sha})});
    if(!write.ok){const t=await write.text();return res.status(write.status).json({error:'GitHub write failed',detail:t});}
    return res.status(200).json(next);
  }catch(e){return res.status(500).json({error:'Notes API failed',detail:e.message});}
};
