export type ConsolePreferences = { language:'en'|'ja'; appearance:'violet'|'graphite'; defaultSessionView:'chat'|'execution'; completionNotifications:boolean; petEnabled:boolean; petId:string; petSource:string; petScale:0.5|0.75|1|1.5|2; petPosition:'left'|'right' };
export const defaultPreferences:ConsolePreferences={language:'en',appearance:'violet',defaultSessionView:'chat',completionNotifications:false,petEnabled:true,petId:'fio',petSource:'bundled',petScale:1,petPosition:'right'};
const key='pi-console:preferences:v1';
export function loadPreferences():ConsolePreferences {
  try {const raw=JSON.parse(localStorage.getItem(key)??'{}');return {
    language:raw.language==='ja'?'ja':'en',appearance:raw.appearance==='graphite'?'graphite':'violet',
    defaultSessionView:raw.defaultSessionView==='execution'?'execution':'chat',completionNotifications:raw.completionNotifications===true,petEnabled:raw.petEnabled!==false,petId:typeof raw.petId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(raw.petId)?raw.petId:'',petSource:typeof raw.petSource==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(raw.petSource)?raw.petSource:'',petScale:[0.5,0.75,1,1.5,2].includes(raw.petScale)?raw.petScale:1,petPosition:raw.petPosition==='left'?'left':'right'
  }}catch{return {...defaultPreferences}}
}
export function savePreferences(value:ConsolePreferences){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Private browsing may disallow storage. */}}
