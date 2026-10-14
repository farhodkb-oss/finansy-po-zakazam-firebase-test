/* Firebase connection. No secrets here: access is enforced by Firestore Security Rules. */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import {initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const config={
 apiKey:'AIzaSyAVwyrSWoEZxVFHwYZG3GjJ9djplIwNPVc',
 authDomain:'finansypozakazam.firebaseapp.com',
 projectId:'finansypozakazam',
 storageBucket:'finansypozakazam.firebasestorage.app',
 messagingSenderId:'516907163790',
 appId:'1:516907163790:web:b8e945579ba75eee7d29df'
};
const firebaseApp=initializeApp(config);
const auth=getAuth(firebaseApp);
const firestore=initializeFirestore(firebaseApp,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
function eventsCollection(){
 const user=auth.currentUser;
 if(!user)throw Error('Для работы с базой требуется вход.');
 // Matches Rules: match /users/{userId}/{document=**} where request.auth.uid == userId
 return collection(firestore,'users',user.uid,'events');
}
const FinanceCloud={
 currentUser:()=>auth.currentUser,
 onAuth:(cb)=>onAuthStateChanged(auth,cb),
 signIn:async(email,password)=>{
   await setPersistence(auth,browserLocalPersistence);
   return signInWithEmailAndPassword(auth,email,password);
 },
 signOut:()=>signOut(auth),
 listen:(onData,onError)=>onSnapshot(eventsCollection(),{includeMetadataChanges:true},snapshot=>{
   const events=[],confirmedIds=new Set();
   snapshot.forEach(s=>{
     const ev=s.data();
     if(ev.event_id!==s.id)throw Error('Неверный идентификатор события в базе.');
     events.push(ev);
     if(!s.metadata.hasPendingWrites&&!snapshot.metadata.fromCache)confirmedIds.add(s.id);
   });
   onData({events,confirmedIds,fromCache:snapshot.metadata.fromCache,hasPendingWrites:snapshot.metadata.hasPendingWrites});
 },onError),
 enqueueEvent:(ev)=>{
   // Immutable document id. Repeating the same event id is idempotent.
   return setDoc(doc(eventsCollection(),ev.event_id),ev);
 },
};
export {FinanceCloud};
