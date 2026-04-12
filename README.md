[README.md](https://github.com/user-attachments/files/26650019/README.md)
# 🎬 CineList

> Catálogo colaborativo de filmes para grupos de amigos — estilo Netflix, com avaliações, estatísticas e muito mais.

---

## 📖 Sobre

O **CineList** é uma PWA (Progressive Web App) de rastreamento e avaliação de filmes pensada para grupos fechados. Cada membro pode registrar o que assistiu, dar notas, ver o que ainda está pendente e acompanhar o ranking da tropa — tudo em uma interface inspirada no Netflix.

---

## ✨ Funcionalidades

### 🎥 Catálogo
- Lista completa de filmes com poster, sinopse, ano, duração e classificação indicativa
- Busca e filtro por gênero
- Painel de detalhes lateral (desktop) e modal (mobile)
- Banner hero rotativo na tela inicial com os destaques

### ⭐ Avaliações
- Cada membro avalia os filmes com nota própria
- Cálculo automático da média do grupo
- Lista de avaliadas ordenada por nota
- Lista de "Não quero assistir" por usuário
- Compartilhamento do filme via WhatsApp

### 📊 Estatísticas
- Ranking de membros por quantidade de filmes assistidos
- Média geral, top 5 e bottom 5 de cada membro
- Histórico de avaliações por ano e por gênero
- Tempo total de cinema calculado por membro

### 👤 Perfis
- Apelido, data de nascimento, bio e filme favorito
- Avatar com cor personalizada ou foto
- Painel de perfil público para ver as avaliações de outros membros

### 🔔 Notificações Push
- Suporte a notificações via **Firebase Cloud Messaging (FCM)**
- Envio manual de notificações pelo painel admin
- Registro do token FCM por usuário no Supabase

### 🔍 Integrações Externas
- **TMDB API** — notas do TMDB, IMDb e Rotten Tomatoes exibidas no detalhe do filme
- **"Onde Assistir"** — verifica disponibilidade do filme nas plataformas de streaming no Brasil

### 🛡️ Admin
- Painel administrativo com abas:
  - **Stats** — visão geral do catálogo e dos membros
  - **Sem avaliação** — filmes que ninguém avaliou ainda
  - **Novo membro** — criação de usuários via Supabase Auth
  - **Excluir filmes** — remoção de filmes do catálogo
  - **Notificação** — envio de push para todos os dispositivos

---

## 🧱 Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML, CSS, JavaScript (Vanilla) |
| Backend / DB | [Supabase](https://supabase.com) (Auth + PostgreSQL) |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| Dados de filmes | [TMDB API](https://www.themoviedb.org/documentation/api) |
| Hospedagem | GitHub Pages |
| PWA | Service Worker + Web App Manifest |

---

## 📱 PWA

O CineList pode ser instalado como app no celular (iOS e Android):

- Ícone na tela inicial
- Funciona em tela cheia (sem barra do navegador)
- Safe area support para iPhones com notch
- Login biométrico via Credential Management API

---

## 🗂️ Estrutura

```
cinelist/
├── index.html         # App completo (SPA em arquivo único)
├── manifest.json      # Configuração do PWA
└── sw.js              # Service Worker (notificações push)
```

---

## 🔑 Variáveis e Configurações

Antes de rodar o projeto, configure as seguintes chaves diretamente no `index.html`:

```js
// Supabase
const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_KEY = 'SUA_ANON_KEY';

// Firebase (FCM)
const firebaseConfig = { ... };
const VAPID = 'SUA_VAPID_KEY';

// TMDB
const TMDB_KEY = 'SUA_TMDB_API_KEY';
```

---

## 🗄️ Tabelas no Supabase

| Tabela | Descrição |
|---|---|
| `filmes` | Catálogo de filmes |
| `avaliacoes` | Notas individuais por usuário |
| `usuarios` | Membros do grupo |
| `perfis` | Dados de perfil (bio, avatar, etc.) |
| `fcm_tokens` | Tokens de push notification por usuário |

---

## 🚀 Como rodar localmente

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/cinelist.git
cd cinelist

# Abra com um servidor local (ex: Live Server no VS Code)
# ou via Python:
python -m http.server 8080
```

> ⚠️ O Service Worker e as notificações push exigem **HTTPS**. Para produção, use GitHub Pages ou outro host com SSL.

---

## 👥 Membros

O app é voltado para **grupos fechados**. Novos membros são criados pelo admin diretamente pelo painel interno, vinculando o e-mail ao Supabase Auth.

---

## 📄 Licença

Projeto privado / uso pessoal. Não possui licença open-source.
