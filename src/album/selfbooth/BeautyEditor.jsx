import { useEffect, useRef, useState } from 'react';
import { PiArrowLeftBold, PiArrowCounterClockwiseBold, PiArrowsLeftRightBold, PiCheckBold, PiHeartBold, PiHeartFill, PiMagnifyingGlassPlusBold, PiTrashBold } from 'react-icons/pi';
import { Button } from '../../studio.jsx';
import { ADJUST_LABELS, BEAUTY_GROUPS, BEAUTY_PRESETS, DEFAULT_ADJUST, isNeutral, normalizeAdjust } from '../../beauty-settings.js';
import { COLOR_FILTERS, FILTER_CSS } from '../../beauty-render.js';
import { PhotoThumb } from '../photo-thumb.jsx';

// Mellow: espresso #3b2a22, ivory #f6efe5, beige #ebe1d3. Serif title,
// 13–16 px control text, 44 px touch targets; photo + independent scroll panel.
export function BeautyEditor({ token, media, photo, adjust, onChange, onClose, onFavorite, onDelete, disabled }) {
  const dialog=useRef(null),view=useRef(null),original=useRef(null),edited=useRef(null);
  const turn=useRef(0);
  const [faceState,setFaceState]=useState({status:'loading',faces:[]});
  const [attempt,setAttempt]=useState(0),[revision,setRevision]=useState(0);
  const [group,setGroup]=useState('all'),[compare,setCompare]=useState(false),[zoom,setZoom]=useState(false);
  const [rendering,setRendering]=useState(false),[renderError,setRenderError]=useState('');
  const a=normalizeAdjust(adjust),adjustKey=JSON.stringify(a);
  const faceReady=faceState.status==='ready' && faceState.faces.length>0;
  const activeGroup=BEAUTY_GROUPS.find(g=>g.id===group);

  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.current?.querySelector('button')?.focus();
    return ()=>{document.body.style.overflow=overflow;previous?.focus?.()};
  },[]);
  useEffect(()=>{
    let alive=true;
    setFaceState({status:'loading',faces:[]});
    media.preview(photo).then(canvas=>{
      if(!alive)return;
      original.current=canvas;setRevision(n=>n+1);
    }).catch(error=>{if(alive)setRenderError(error.message)});
    media.facesOf(photo,{retry:attempt>0}).then(faces=>{
      if(alive)setFaceState({status:'ready',faces});
    }).catch(error=>{if(alive)setFaceState({status:'error',faces:[],message:error.message})});
    return ()=>{alive=false};
  },[media,photo.id,attempt]);

  useEffect(()=>{
    const current=++turn.current;
    setRenderError('');
    if(isNeutral(a)) {
      edited.current && (edited.current.width=edited.current.height=0);
      edited.current=null;setRendering(false);setRevision(n=>n+1);
      return;
    }
    setRendering(true);
    const timer=setTimeout(async()=>{
      try {
        const canvas=await media.edited(photo,a,'preview',{isCurrent:()=>current===turn.current});
        if(current!==turn.current){canvas.width=canvas.height=0;return}
        if(edited.current)edited.current.width=edited.current.height=0;
        edited.current=canvas;setRevision(n=>n+1);
      }catch(error){if(current===turn.current && error.name!=='AbortError')setRenderError(error.message)}
      finally{if(current===turn.current)setRendering(false)}
    },60);
    return ()=>{turn.current++;clearTimeout(timer)};
  },[media,photo.id,adjustKey,attempt]);
  useEffect(()=>()=>{turn.current++;if(edited.current)edited.current.width=edited.current.height=0},[]);

  useEffect(()=>{
    const source=compare || !edited.current?original.current:edited.current,c=view.current;
    if(!source?.width || !c)return;
    c.width=source.width;c.height=source.height;
    const ctx=c.getContext('2d');
    if(zoom) {
      const face=faceState.faces[0];
      const cx=face?face[168].x:source.width/2,cy=face?(face[168].y+face[152].y)/2:source.height/2;
      const w=source.width/2,h=source.height/2;
      ctx.drawImage(source,Math.max(0,Math.min(source.width-w,cx-w/2)),Math.max(0,Math.min(source.height-h,cy-h/2)),w,h,0,0,c.width,c.height);
    }else ctx.drawImage(source,0,0);
  },[revision,compare,zoom,faceState]);

  function keydown(event) {
    if(event.key==='Escape'){event.preventDefault();onClose();return}
    if(event.target.getAttribute('role')==='tab' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const index=BEAUTY_GROUPS.findIndex(g=>g.id===group);
      const next=event.key==='Home'?0:event.key==='End'?BEAUTY_GROUPS.length-1:(index+(event.key==='ArrowLeft'?-1:1)+BEAUTY_GROUPS.length)%BEAUTY_GROUPS.length;
      setGroup(BEAUTY_GROUPS[next].id);dialog.current.querySelector(`#beauty-tab-${BEAUTY_GROUPS[next].id}`)?.focus();return;
    }
    if(event.key!=='Tab')return;
    const controls=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>el.tabIndex>=0 && el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus()}
  }
  function change(key,value){setCompare(false);onChange({...a,[key]:value})}
  const notice=faceState.status==='loading'?'Đang chuẩn bị bộ làm đẹp…':faceState.status==='error'
    ? 'Chưa mở được bộ nhận diện. Màu ảnh vẫn dùng được.' : !faceState.faces.length
      ? 'Chưa nhận diện được khuôn mặt rõ. Bạn vẫn đổi màu ảnh được.'
      : `Đã nhận diện ${faceState.faces.length} khuôn mặt · chỉnh trên ảnh này`;
  return <div ref={dialog} className="sb-editor sb-beauty-editor" role="dialog" aria-modal="true" aria-label={`Chỉnh ảnh ${String(photo.number).padStart(2,'0')}`} onKeyDown={keydown}>
    <header className="sb-beauty-head">
      <button type="button" className="sb-icon" onClick={onClose} aria-label="Đóng"><PiArrowLeftBold aria-hidden="true"/></button>
      <div><span className="sb-beauty-eyebrow">CHỈNH ẢNH</span><h2>Làm đẹp <em>theo bạn</em></h2></div>
      <span className="sb-beauty-number">#{String(photo.number).padStart(2,'0')}</span>
      <button type="button" className="sb-icon sb-heart" aria-pressed={photo.favorite} disabled={disabled} aria-label={photo.favorite?'Bỏ tim':'Thả tim'} onClick={()=>onFavorite(photo)}>{photo.favorite?<PiHeartFill/>:<PiHeartBold/>}</button>
      <button type="button" className="sb-icon" disabled={disabled} aria-label="Xoá ảnh" onClick={()=>onDelete([photo.id])}><PiTrashBold/></button>
    </header>
    <div className="sb-editor-view sb-beauty-view">
      <canvas ref={view} aria-label={compare?'Ảnh gốc để so sánh':'Ảnh xem trước'}/>
      <div className="sb-beauty-view-tools">
        <button type="button" aria-pressed={zoom} aria-label="Phóng to ảnh" onClick={()=>setZoom(v=>!v)}><PiMagnifyingGlassPlusBold aria-hidden="true"/>{zoom?'2×':'1×'}</button>
        <button type="button" aria-pressed={compare} disabled={isNeutral(a)} onClick={()=>setCompare(v=>!v)}><PiArrowsLeftRightBold aria-hidden="true"/>{compare?'Đang xem ảnh gốc':'So sánh ảnh gốc'}</button>
      </div>
      {(!original.current || rendering) && <p className="sb-editor-note" role="status">{!original.current?'Đang mở ảnh…':compare?'Ảnh gốc · đang chuẩn bị bản chỉnh':'Đang cập nhật ảnh…'}</p>}
      {compare && !rendering && <span className="sb-beauty-original-tag">Ảnh gốc · chưa chỉnh</span>}
    </div>
    <section className="sb-beauty-panel" aria-label="Công cụ làm đẹp">
      <div className={`sb-beauty-status${!faceReady && faceState.status!=='loading'?' is-warn':''}`} role="status">
        <span>{notice}</span>
        {faceState.status!=='loading' && !faceReady && <button type="button" onClick={()=>setAttempt(n=>n+1)}>Nhận diện lại</button>}
      </div>
      {renderError && <p className="sb-beauty-error" role="alert">Chưa áp dụng được: {renderError} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></p>}
      <div className="sb-beauty-presets" role="group" aria-label="Chọn nhanh mức làm đẹp">
        {BEAUTY_PRESETS.map(p=><button key={p.id} type="button" disabled={disabled || !faceReady}
          aria-pressed={Object.keys(ADJUST_LABELS).every(key=>a[key]===(p.values[key]||0))}
          onClick={()=>{setCompare(false);onChange({...DEFAULT_ADJUST,...p.values,filter:a.filter})}}>{p.label}</button>)}
      </div>
      <div className="sb-editor-tabs" role="tablist" aria-label="Làm đẹp">
        {BEAUTY_GROUPS.map(g=><button type="button" key={g.id} role="tab" tabIndex={group===g.id?0:-1} id={`beauty-tab-${g.id}`} aria-controls="beauty-controls" aria-selected={group===g.id} onClick={()=>setGroup(g.id)}>{g.label}</button>)}
      </div>
      <div className="sb-beauty-scroll" id="beauty-controls" role="tabpanel" aria-labelledby={`beauty-tab-${group}`}>
        <p className="sb-beauty-control-caption">{group==='all'?'10 mức chỉnh · cuộn để xem thêm':group==='eyes'?'Tròng mắt: tăng nhẹ kích thước mống mắt':group==='color'?'Chọn một tông màu cho ảnh':activeGroup.label}</p>
        {group!=='color'?<div className="sb-beauty-sliders">
          {activeGroup.keys.map(key=><label className="sb-beauty-slider" key={key}>
            <span>{ADJUST_LABELS[key]}<output>{a[key]}</output></span>
            <input type="range" min="0" max="100" step="1" value={a[key]} disabled={disabled || !faceReady} aria-label={ADJUST_LABELS[key]} style={{'--level':`${a[key]}%`}} onChange={event=>change(key,Number(event.target.value))}/>
          </label>)}
        </div>:<div className="sb-editor-filters" role="radiogroup" aria-label="Bộ lọc màu">
          {Object.entries(COLOR_FILTERS).map(([key,label])=><button key={key} type="button" role="radio" aria-checked={a.filter===key} disabled={disabled} onClick={()=>change('filter',key)}>
            <PhotoThumb photo={photo} token={token} alt="" style={{filter:FILTER_CSS[key]||'none'}}/>
            <span>{label}</span>
          </button>)}
        </div>}
        <p className="sb-beauty-hint">0 giữ nguyên · tăng từ từ để xem mức hợp với bạn. Ảnh gốc luôn được giữ riêng.</p>
      </div>
    </section>
    <footer className="sb-editor-foot sb-beauty-foot">
      <Button className="outline" disabled={disabled || isNeutral(a)} onClick={()=>{setCompare(false);onChange({...DEFAULT_ADJUST})}}><PiArrowCounterClockwiseBold aria-hidden="true"/> Đặt lại</Button>
      <Button onClick={onClose}><PiCheckBold aria-hidden="true"/> Xong</Button>
    </footer>
  </div>;
}
