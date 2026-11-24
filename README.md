# MultiStream Studio

Aplicação web gratuita e sem dependências de backend para assistir múltiplas lives e vídeos simultaneamente em uma única tela, com player unificado, **chats integrados com fechamento rápido para liberar espaço**, controle de volume por tela, modo Solo Áudio e redimensionamento proporcional (`16:9`).

## Como executar

Para que os chats incorporados do **YouTube** (`embed_domain`) e da **Twitch** (`parent`) funcionem corretamente, execute via servidor HTTP local (em vez de abrir via `file://`):

```bash
# Com Python:
python -m http.server 8080

# Ou com Node.js:
npx serve .
```

Acesse `http://localhost:8080` no navegador.

## Recursos Principais

- **Chat por Tela (`💬 Chat`):** Cada tela com live da Kick, YouTube ou Twitch possui um botão para abrir/fechar seu respectivo chat ao lado do player.
- **Fechamento sem recarregar o vídeo (`✕ Fechar`):** Ao fechar o chat de uma tela (ou clicar em **Fechar Chats** na barra superior), o iframe do chat é removido da memória e o player de vídeo se expande instantaneamente em `16:9` sem interromper a transmissão.
- **Largura Ajustável & Popout:** Arraste a divisória entre o vídeo e o chat para ajustar a largura do chat, ou clique em **Popout ↗** para abri-lo em uma janela separada.
