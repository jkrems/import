import b from './cycle-b.js';

export default function a() {
  return b();
}

console.log(a());
