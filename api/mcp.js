const { createRemoteJWKSet, jwtVerify } = require('jose');

const OWNER=process.env.GITHUB_OWNER;
const REPO=process.env.GITHUB_REPO;
const TOKEN=process.env.GITHUB_TOKEN;
const AUTH_ISSUER=process.env.AUTH_ISSUER;
const AUTH_AUDIENCE=process.env.AUTH_AUDIENCE;
const NOTES_DIR='notes';

function ghHeaders(){return{'Authorization':`Bearer ${TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
function decode(f){return JSON.parse(Buffer.from(f.content.replace(/\n/g,''),'base64').toString('utf8'));}
async function ghGet(path){const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,{headers:ghHeaders()});if(r.status===404)return null;if(!r.ok)throw new Error(`GitHub read failed (${r.status})`);return r.json();}
async function verifyAuth(req){if(!AUTH_ISSUER||!AUTH_AUDIENCE)return null;const raw=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return null;try{const jwks=createRemoteJWKSet(new URL(`${AUTH_ISSUER.replace(/\/$/,'')}/.well-known/jwks.json`));const {payload}=await jwtVerify(raw,jwks,{issuer:AUTH_ISSUER,audience:AUTH_AUDIENCE});return payload;}catch{return null;}}
async function allNotes(){const map=new Map();const legacy=await ghGet('notes.json');if(legacy)for(const p of (decode(legacy).pages||[]))if(p?.id)map.set(p.id,p);const dir=await ghGet(NOTES_DIR);if(Array.isArray(dir)){const vals=await Promise.all(dir.filter(f=>f.type==='file'&&f.name.endsWith('.json')).map(async f=>{try{return decode(await ghGet(f.path))}catch{return null}}));for(const p of vals)if(p?.id)map.set(p.id,p);}return[...map.values()].sort((a,b)=>(+b.updated||0)-(+a.updated||0));}
function clean(input,old){const id=String(input.id||'').trim();if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw new Error('Invalid note ID');const title=String(input.title||'').trim().slice(0,300);const text=String(input.body||'');if(text.length>500000)throw new Error('Note is too large');const now=Date.now();return{version:1,id,title,body:text,blocks:[{id:`text-${id}`,type:'text',text}],created:Number(old?.created)||now,updated:now};}
async function save(input,mustExist){const path=`${NOTES_DIR}/${input.id}.json`;const file=await ghGet(path);if(mustExist&&!file)throw new Error('Note not found');if(!mustExist&&file)throw new Error('Note ID already exists');const page=clean(input,file?decode(file):null);const payload={message:file?`Update note: ${page.title||page.id}`:`Add note: ${page.title||page.id}`,content:Buffer.from(JSON.stringify(page,null,2)).toString('base64')};if(file)payload.sha=file.sha;const r=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,{method:'PUT',headers:ghHeaders(),body:JSON.stringify(payload)});if(!r.ok)throw new Error(`GitHub write failed (${r.status})`);return page;}
function result(x){return{content:[{type:'text',text:JSON.stringify(x,null,2)}],structuredContent:x};}

const security=[{type:'oauth2',scopes:['notes:read','notes:write']}];
const tools=[
{name:'list_notes',title:'List Personal Notes',description:'List note IDs and titles, newest first.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:100}}},annotations:{readOnlyHint:true},securitySchemes:security},
{name:'search_notes',title:'Search Personal Notes',description:'Search note titles and bodies.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},annotations:{readOnlyHint:true},securitySchemes:security},
{name:'get_note',title:'Read Personal Note',description:'Read one note by exact ID.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']},annotations:{readOnlyHint:true},securitySchemes:security},
{name:'create_note',title:'Create Personal Note',description:'Create a new note with a unique slug-like ID, title and complete body.',inputSchema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['id','title','body']},annotations:{readOnlyHint:false,destructiveHint:false},securitySchemes:security},
{name:'update_note',title:'Update Personal Note',description:'Update an existing note. Read it first, then provide the complete desired title and body.',inputSchema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['id','title','body']},annotations:{readOnlyHint:false,destructiveHint:false},securitySchemes:security}
];

async function callTool(name,a){const notes=async()=>allNotes();if(name==='list_notes'){const n=await notes();return result({notes:n.slice(0,a.limit||30).map(p=>({id:p.id,title:p.title,updated:p.updated}))});}if(name==='search_notes'){const q=String(a.query||'').toLowerCase(),n=await notes();return result({notes:n.filter(p=>`${p.title||''}\n${p.body||''}`.toLowerCase().includes(q)).map(p=>({id:p.id,title:p.title,updated:p.updated}))});}if(name==='get_note'){const n=await notes(),p=n.find(x=>x.id===a.id);if(!p)throw new Error('Note not found');return result(p);}if(name==='create_note')return result(await save(a,false));if(name==='update_note')return result(await save(a,true));throw new Error('Unknown tool');}

module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!OWNER||!REPO||!TOKEN||!AUTH_ISSUER||!AUTH_AUDIENCE)return res.status(500).json({error:'MCP environment is not configured'});
 const auth=await verifyAuth(req);
 if(!auth){res.setHeader('WWW-Authenticate','Bearer');return res.status(401).json({error:'Unauthorized'});}
 const r=typeof req.body==='string'?JSON.parse(req.body):req.body||{},id=r.id??null;
 try{
  if(r.method==='initialize')return res.status(200).json({jsonrpc:'2.0',id,result:{protocolVersion:r.params?.protocolVersion||'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'personal-notes',version:'1.0.0'}}});
  if(r.method==='notifications/initialized')return res.status(202).end();
  if(r.method==='tools/list')return res.status(200).json({jsonrpc:'2.0',id,result:{tools}});
  if(r.method==='tools/call')return res.status(200).json({jsonrpc:'2.0',id,result:await callTool(r.params?.name,r.params?.arguments||{})});
  return res.status(200).json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 }catch(e){return res.status(200).json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:e.message||'Tool failed'}],isError:true}});}
};
