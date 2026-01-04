/**
 * Tessera Durable Object
 * Handles transparency log operations with SQLite storage
 */
export class Tessera {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Hello from Tessera!');
    }

    return new Response('Not Found', { status: 404 });
  }
}
