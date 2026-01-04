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
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Hello from Tessera!');
    }

    return new Response('Not Found', { status: 404 });
  }
}
