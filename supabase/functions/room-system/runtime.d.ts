declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request, connection?: { remoteAddr?: { hostname?: string } }) => Response | Promise<Response>): unknown
}
