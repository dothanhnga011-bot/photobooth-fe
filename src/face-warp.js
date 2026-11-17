import { average, containsPoint, faceAxes, faceWidth, LEFT_EYE, RIGHT_EYE, LIPS } from './face-regions.js';

const JAW = [[132,361,.018],[58,288,.028],[172,397,.038],[136,365,.045],[150,379,.045],[149,378,.036],[176,400,.024]];
const level = value => Math.max(0,Math.min(100,Number(value)||0))/100;
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));

function controlsOf(face, adjust) {
  const fw=faceWidth(face), axes=faceAxes(face), controls=[];
  if (!Number.isFinite(fw) || fw<=0) return controls;
  if (adjust.slim>0) {
    const a=face[168],b=face[152],length=(b.x-a.x)**2+(b.y-a.y)**2||1;
    for(const [left,right,weight] of JAW) for(const i of [left,right]) {
      const p=face[i],t=((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/length;
      const dx=a.x+t*(b.x-a.x)-p.x,dy=a.y+t*(b.y-a.y)-p.y,distance=Math.hypot(dx,dy)||1;
      const move=Math.min(distance*.5,fw*weight*level(adjust.slim)*1.6);
      if(move>0) controls.push({kind:'move',x:p.x,y:p.y,rx:fw*.22,ry:fw*.22,ux:1,uy:0,vx:0,vy:1,dx:-dx/distance*move,dy:-dy/distance*move});
    }
  }
  const scale = (center,rx,ry,sx,sy,clip=null) => {
    if (rx>0 && ry>0) {
      const clipCenter=clip?average(face,clip):null;
      const halfHeight=clip?Math.max(...clip.map(i=>Math.abs((face[i].x-clipCenter.x)*axes.vx+(face[i].y-clipCenter.y)*axes.vy))):0;
      controls.push({kind:'scale',...center,...axes,rx,ry,sx,sy,clip,face,clipCenter,halfHeight});
    }
  };
  for(const eye of [LEFT_EYE,RIGHT_EYE]) {
    const center=average(face,eye);
    const width=Math.hypot(face[eye[0]].x-face[eye[8]].x,face[eye[0]].y-face[eye[8]].y);
    if(width<fw*.04 || width>fw*.55) continue;
    if(adjust.eyeSize>0) scale(center,width*.95,width*.7,-level(adjust.eyeSize)*.18,-level(adjust.eyeSize)*.24);
    if(adjust.irisSize>0 && face.length>=478) {
      const start=eye===LEFT_EYE?468:473, iris=face[start];
      const radius=[1,2,3,4].reduce((n,i)=>n+Math.hypot(face[start+i].x-iris.x,face[start+i].y-iris.y),0)/4;
      // A covered/undetected iris has unreliable size: leave it alone rather
      // than stretching the eyelid or moving the entire eye.
      if(radius>width*.04 && radius<width*.4 && containsPoint(iris.x,iris.y,face,eye))
        scale(iris,radius*2.1,radius*2.1,-level(adjust.irisSize)*.25,-level(adjust.irisSize)*.25,eye);
    }
  }
  if(adjust.nose>0) scale(face[4],fw*.2,fw*.25,level(adjust.nose)*.22,level(adjust.nose)*.045);
  if(adjust.mouth>0) {
    const center=average(face,LIPS),width=Math.hypot(face[61].x-face[291].x,face[61].y-face[291].y);
    if(width>fw*.08 && width<fw*.7) scale(center,width*.95,width*.58,level(adjust.mouth)*.2,level(adjust.mouth)*.12);
  }
  return controls;
}

// Merge every active shape control before a single bilinear readback. A nose,
// mouth, eye and jaw edit never resamples the full image four separate times.
export function warpFaces(data,width,height,faces,adjust) {
  for(const face of faces) {
    const controls=controlsOf(face,adjust);
    if(!controls.length) continue;
    const reach=p=>Math.max(p.rx,p.ry);
    const margin=Math.ceil(Math.max(...controls.map(p=>p.kind==='move'?Math.hypot(p.dx,p.dy):reach(p)*Math.max(Math.abs(p.sx),Math.abs(p.sy)))))+2;
    const x0=Math.max(0,Math.floor(Math.min(...controls.map(p=>p.x-reach(p)))-margin));
    const x1=Math.min(width-1,Math.ceil(Math.max(...controls.map(p=>p.x+reach(p)))+margin));
    const y0=Math.max(0,Math.floor(Math.min(...controls.map(p=>p.y-reach(p)))-margin));
    const y1=Math.min(height-1,Math.ceil(Math.max(...controls.map(p=>p.y+reach(p)))+margin));
    if(x1<x0 || y1<y0) continue;
    const stride=x1-x0+1,copy=new Uint8ClampedArray((y1-y0+1)*stride*4);
    for(let y=y0;y<=y1;y++) copy.set(data.subarray((y*width+x0)*4,(y*width+x1+1)*4),(y-y0)*stride*4);
    const weights=new Float32Array(stride),dxs=new Float32Array(stride),dys=new Float32Array(stride);
    for(let y=y0;y<=y1;y++) {
      weights.fill(0);dxs.fill(0);dys.fill(0);
      for(const p of controls) {
        const r=reach(p);
        if(Math.abs(y-p.y)>r)continue;
        const start=Math.max(x0,Math.ceil(p.x-r)),end=Math.min(x1,Math.floor(p.x+r));
        for(let x=start;x<=end;x++) {
          const ax=x-p.x,ay=y-p.y,u=ax*p.ux+ay*p.uy,v=ax*p.vx+ay*p.vy;
          const radius=(u/p.rx)**2+(v/p.ry)**2;
          if(radius>=1 || p.clip && !containsPoint(x,y,p.face,p.clip))continue;
          let weight=(1-radius)**2;
          // Fade iris changes near the eyelids; the lid's pixels stay put.
          if(p.clip) {
            const c=p.clipCenter,halfHeight=p.halfHeight;
            const eyelid=Math.abs((x-c.x)*p.vx+(y-c.y)*p.vy);
            weight*=clamp((halfHeight-eyelid)/Math.max(1,halfHeight*.4),0,1);
          }
          const i=x-x0;
          weights[i]+=weight;
          dxs[i]+=(p.kind==='move'?p.dx:p.sx*u*p.ux+p.sy*v*p.vx)*weight;
          dys[i]+=(p.kind==='move'?p.dy:p.sx*u*p.uy+p.sy*v*p.vy)*weight;
        }
      }
      for(let x=x0;x<=x1;x++) {
        const i=x-x0;
        if(!weights[i])continue;
        const divisor=Math.max(1,weights[i]),sx=clamp(x+dxs[i]/divisor,x0,x1),sy=clamp(y+dys[i]/divisor,y0,y1);
        const ix=Math.floor(sx),iy=Math.floor(sy),nx=Math.min(x1,ix+1),ny=Math.min(y1,iy+1),fx=sx-ix,fy=sy-iy;
        const s0=((iy-y0)*stride+ix-x0)*4,s1=((iy-y0)*stride+nx-x0)*4;
        const s2=((ny-y0)*stride+ix-x0)*4,s3=((ny-y0)*stride+nx-x0)*4;
        const w0=(1-fx)*(1-fy),w1=fx*(1-fy),w2=(1-fx)*fy,w3=fx*fy;
        const a0=copy[s0+3]*w0,a1=copy[s1+3]*w1,a2=copy[s2+3]*w2,a3=copy[s3+3]*w3;
        const alpha=a0+a1+a2+a3;
        if(alpha<1)continue;
        const dest=(y*width+x)*4;
        for(let c=0;c<3;c++) data[dest+c]=(copy[s0+c]*a0+copy[s1+c]*a1+copy[s2+c]*a2+copy[s3+c]*a3)/alpha;
        // Keep original transparency: geometry must never punch holes in crops.
      }
    }
  }
}
