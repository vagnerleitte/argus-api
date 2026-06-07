# argus-api

Backend NestJS simples com:

- POST /applications/upload — envia um arquivo binário (zip, tgz, tar, etc.) e salva localmente em uploads/
- POST /applications — cadastra metadados da aplicação
- GET /applications — lista todas as aplicações cadastradas

## Como rodar

1. npm install
2. npm run start:dev

A API ficará disponível em http://localhost:3000

## Exemplo de uso

- Upload: curl -F "file=@meu-arquivo.zip" http://localhost:3000/applications/upload
- Cadastrar app: curl -X POST http://localhost:3000/applications -H "Content-Type: application/json" -d '{"name":"Demo","version":"1.0.0","description":"Exemplo"}'
- Listar apps: curl http://localhost:3000/applications
# argus-api
