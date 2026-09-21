const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(data);
