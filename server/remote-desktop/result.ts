import type {RemoteOperation} from './types.ts';
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const inspectionKeys=new Set(['automationId','children','className','coordinateSpace','depth','dpiAwareness','elementCount','elements','expandState','height','hideDisabled','hideOffscreen','hwnd','interactive','isEnabled','isInvokable','isOffscreen','name','scale','selector','title','toggleState','type','value','width','windowDpi','windows','x','y']);
function inspection(value:any,depth=0):any{
 if(depth>32)throw Error('remote_result_shape_invalid');
 if(Array.isArray(value)){if(value.length>4096)throw Error('remote_result_shape_invalid');return value.map(v=>inspection(v,depth+1));}
 if(object(value)){const projected:Record<string,unknown>={};for(const[k,v]of Object.entries(value)){if(!inspectionKeys.has(k))throw Error('remote_result_shape_invalid');if(k!=='hwnd')projected[k]=inspection(v,depth+1);}return projected;}
 if(typeof value==='string'&&value.length<=16384||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||value===null)return value;
 throw Error('remote_result_shape_invalid');
}
/** Only known Phase7 result fields cross into model-visible history. */
export function projectRemoteResult(operation:RemoteOperation,result:any):any{
 if(operation.startsWith('caivi_')){if(!object(result)||Object.keys(result).sort().join(',')!=='after,before')throw Error('remote_result_shape_invalid');return{before:projectRemoteResult('inspect',result.before),after:projectRemoteResult('inspect',result.after)};}
 if(operation==='file_send')return{bytes:result.bytes,sha256:result.sha256};
 const allowed=['identity','uia','inspect','action_attempts',...(operation==='screenshot'?['mime_type','png_base64']:[])];
 if(!object(result)||Object.keys(result).some(k=>!allowed.includes(k))||!object(result.identity)||typeof result.uia!=='string'||result.uia.length>1024||!object(result.inspect))throw Error('remote_result_shape_invalid');
 if(operation==='screenshot'){
  if(result.mime_type!=='image/png'||typeof result.png_base64!=='string'||result.png_base64.length>8*1024*1024)throw Error('screenshot_invalid');
  const png=Buffer.from(result.png_base64,'base64');try{if(png.toString('base64')!==result.png_base64||png.length>6*1024*1024||png.length<8||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('screenshot_invalid');}finally{png.fill(0);}
  return{mime_type:'image/png',png_base64:result.png_base64};
 }
 return{uia:result.uia,inspect:inspection(result.inspect)};
}
