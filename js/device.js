export function getOrCreateDeviceId(){
  const KEY = "TOURNOI_DEVICE_ID_V1";
  let v = localStorage.getItem(KEY);
  if(!v){
    v = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2) + Date.now().toString(16));
    localStorage.setItem(KEY, v);
  }
  return v;
}
