export function piControlCatalog():any[];
export function createPiControlCompanion(options:{post:(route:string,body:any,token?:string,signal?:AbortSignal)=>Promise<any>;now?:()=>number;generation?:()=>string}):{handles(name:string):boolean;catalog():any[];call(id:any,name:string,args:any):Promise<any>;cancel(id:any):void;close():void};
