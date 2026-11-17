import { createImageCanvas } from './image-canvas.js';
import { featherSkinRegion, skinColorWeight } from './skin-retouch.js';
import { average, containsPoint, faceAxes, faceWidth, FACE_OVAL, LEFT_EYE, RIGHT_EYE, LIPS, INNER_LIPS, tracePath } from './face-regions.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const luma=(r,g,b)=>.299*r+.587*g+.114*b;
const level=n=>clamp(Number(n)||0,0,100)/100;

function reduceDarkCircles(data,width,height,face,amount) {
  const fw=faceWidth(face),axes=faceAxes(face);
  for(const [eye,cheek] of [[LEFT_EYE,50],[RIGHT_EYE,280]]) {
    const eyeCenter=average(face,eye),ew=Math.hypot(face[eye[0]].x-face[eye[8]].x,face[eye[0]].y-face[eye[8]].y);
    if(ew<fw*.04)continue;
    const center={x:eyeCenter.x+axes.vx*ew*.3,y:eyeCenter.y+axes.vy*ew*.3};
    const rx=ew*.64,ry=ew*.25;
    // Sample that person's cheek, never a fixed skin tone. Only lift pixels
    // darker than the surrounding skin; preserve lashes, eye whites and lips.
    let reference=0,weight=0;
    const p=face[cheek],sampleRadius=Math.max(1,Math.round(fw*.025));
    for(let y=Math.max(0,Math.round(p.y)-sampleRadius);y<=Math.min(height-1,Math.round(p.y)+sampleRadius);y++)
      for(let x=Math.max(0,Math.round(p.x)-sampleRadius);x<=Math.min(width-1,Math.round(p.x)+sampleRadius);x++) {
        const o=(y*width+x)*4,s=skinColorWeight(data[o],data[o+1],data[o+2])*data[o+3]/255;
        reference+=luma(data[o],data[o+1],data[o+2])*s;weight+=s;
      }
    if(!weight)continue;
    reference/=weight;
    for(let y=Math.max(0,Math.floor(center.y-rx));y<=Math.min(height-1,Math.ceil(center.y+rx));y++)
      for(let x=Math.max(0,Math.floor(center.x-rx));x<=Math.min(width-1,Math.ceil(center.x+rx));x++) {
        const dx=x-center.x,dy=y-center.y,r=((dx*axes.ux+dy*axes.uy)/rx)**2+((dx*axes.vx+dy*axes.vy)/ry)**2;
        if(r>=1 || !containsPoint(x,y,face,FACE_OVAL) || containsPoint(x,y,face,eye))continue;
        const o=(y*width+x)*4,light=luma(data[o],data[o+1],data[o+2]);
        const lift=clamp((reference-light)*.7,0,22)*amount*(1-r)**2*skinColorWeight(data[o],data[o+1],data[o+2])*data[o+3]/255;
        for(let c=0;c<3;c++)data[o+c]+=lift;
      }
  }
}

function tintLips(data,width,height,face,amount) {
  const fw=faceWidth(face),points=LIPS.map(i=>face[i]);
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-2),top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-2);
  const right=Math.min(width-1,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(height-1,Math.ceil(Math.max(...points.map(p=>p.y)))+2);
  if(right<=left || bottom<=top)return;
  const w=right-left+1,h=bottom-top+1,maskCanvas=createImageCanvas(w,h),ctx=maskCanvas.getContext('2d',{willReadFrequently:true});
  ctx.translate(-left,-top);ctx.fillStyle='#fff';tracePath(ctx,face,LIPS);ctx.fill();
  ctx.globalCompositeOperation='destination-out';tracePath(ctx,face,INNER_LIPS);ctx.fill();
  const pixels=ctx.getImageData(0,0,w,h).data,mask=new Float32Array(w*h);
  for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]/255;
  featherSkinRegion(mask,w,h,Math.max(1,fw*.007));
  maskCanvas.width=maskCanvas.height=0;
  const target=[184,65,88],base=luma(...target);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const o=((y+top)*width+x+left)*4,m=mask[y*w+x]*amount*.52*data[o+3]/255;
    if(!m)continue;
    const light=luma(data[o],data[o+1],data[o+2]),gain=clamp(light/base,.2,2.3);
    const highlight=clamp((246-light)/65,0,1);
    for(let c=0;c<3;c++)data[o+c]+=(clamp(target[c]*gain,0,255)-data[o+c])*m*highlight;
  }
}

export function applyMakeup(data,width,height,faces,adjust) {
  for(const face of faces) {
    if(adjust.darkCircles>0)reduceDarkCircles(data,width,height,face,level(adjust.darkCircles));
    if(adjust.lips>0)tintLips(data,width,height,face,level(adjust.lips));
  }
}
