export { Tessera } from './tessera.js';

export default {
  async fetch(request, env, ctx) {
    const id = env.TESSERA.idFromName('log');
    const stub = env.TESSERA.get(id);
    return stub.fetch(request);
  },
};
