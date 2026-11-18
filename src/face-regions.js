// MediaPipe topology; positions are pixels in the original, upright image.
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
export const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export const LEFT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
export const RIGHT_EYE = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
export const LEFT_BROW = [70,63,105,66,107,55,65,52,53,46];
export const RIGHT_BROW = [300,293,334,296,336,285,295,282,283,276];
export const LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
export const INNER_LIPS = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191];
export const faceWidth = f => Math.hypot(f[454].x-f[234].x,f[454].y-f[234].y);
// Selfbooth's face-tile strategy, with room for this engine's combined warps.
// Work at source resolution without allocating a full 20MP mask for each face.
export function faceCrop(face, width, height) {
  if (!Array.isArray(face) || face.length < 468 || !face.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const fw = faceWidth(face);
  if (!(fw > 3)) return null;
  const margin = fw * .45 + 4, points = FACE_OVAL.map(i => face[i]);
  const x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) - margin));
  const y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) - margin));
  const right = Math.min(width, Math.ceil(Math.max(...points.map(p => p.x)) + margin));
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map(p => p.y)) + margin));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
export const average = (face, indices) => ({
  x: indices.reduce((n,i)=>n+face[i].x,0)/indices.length,
  y: indices.reduce((n,i)=>n+face[i].y,0)/indices.length,
});
export function faceAxes(face) {
  const left = average(face, LEFT_EYE), right = average(face, RIGHT_EYE);
  const length = Math.hypot(right.x-left.x,right.y-left.y) || 1;
  const ux=(right.x-left.x)/length, uy=(right.y-left.y)/length;
  const sign=(face[152].x-face[168].x)*(-uy)+(face[152].y-face[168].y)*ux >= 0 ? 1 : -1;
  return { ux, uy, vx:-uy*sign, vy:ux*sign };
}
export function containsPoint(x,y,face,indices) {
  let inside=false;
  for(let i=0,j=indices.length-1;i<indices.length;j=i++) {
    const a=face[indices[i]],b=face[indices[j]];
    if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function tracePath(ctx,face,indices,scale=1) {
  const center=average(face,indices);
  ctx.beginPath();
  indices.forEach((i,k)=>{
    const x=center.x+(face[i].x-center.x)*scale,y=center.y+(face[i].y-center.y)*scale;
    if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);
  });
  ctx.closePath();
}
