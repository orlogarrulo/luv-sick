# COMPRA TUDO — app cliente

React Native com Expo. A loja web e a gestão continuam no Vercel. Esta app não tem catálogo próprio: lê e grava no mesmo servidor e na mesma base de dados, em `POST /api/mobile`.

## Arranque

```bash
cd mobile
npm install
npx expo start
```

No primeiro ecrã, indica o endereço do servidor já publicado (o mesmo da loja web), por exemplo `https://o-teu-projeto.vercel.app`. Sem barra no fim.

O código de acesso aparece no ecrã, como na loja web, enquanto o SMS real não está ligado.
