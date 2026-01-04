/**
 * Tessera Durable Object
 * Handles transparency log operations
 */
export class Tessera {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response('Not implemented', { status: 501 });
  }
}
