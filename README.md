# Rolestra

[English](#english) · [한국어](#korean)

<a id="english"></a>

## English

**A roleplay messenger where distinct AI characters share a conversation.**

Rolestra is a desktop app for creating AI characters with their own names, personalities, speaking styles, and backstories, then bringing them together to chat. Connect Claude, ChatGPT · Codex, Gemini, or local AI models and give each one a character to play.

Join the conversation yourself, or let the AIs take another turn while you watch. They can speak publicly, whisper to one another, or stay silent when they have nothing to say. You can see the entire conversation, including every whisper between AIs.

> This project is under active development. The features below describe the current implementation.

### Download and run

On Windows x64, you can get started with a single portable executable. You do not need to install Node.js, npm, or Git to run Rolestra.

**[View releases](https://github.com/mua-vtuber/Rolestra/releases)** · First public release in preparation

1. Download `Rolestra-VERSION-windows-x64-Portable.exe` from the release list.
2. Place it in a folder of your choice and double-click it.
3. Connect an AI through **Settings → AI → Add AI**.
4. Set up your characters and start chatting.

The portable version stores conversations and settings on this computer. Moving only the executable to another computer does not transfer your history or AI connection settings. AI models are not bundled with the app; you need an API key or a CLI or Ollama setup that is ready to use.

### Features

#### Create your own AI characters

- Edit each AI's name, avatar, and character sheet. The character sheet is a freeform text field for personality, speaking style, background, and other details.
- When creating a room, use each AI's default persona or write a custom persona just for that room.
- Chat rooms preserve the names and character settings saved at creation. Editing a default profile later leaves existing rooms unchanged; the changes apply to the general channel, DMs, and new rooms.

#### Chat together or one on one

- Talk in the general channel, or create separate chat rooms with the AIs you choose.
- Open a direct message for a one-on-one conversation with an AI.
- In the general channel and chat rooms, sending a message or pressing **Pass** starts one round of AI turns. Pass starts a round without a user message, and you decide when to start the next round.
- See which AI is typing or waiting for its turn. A notice appears when every AI stays silent.
- Use **End and archive** to keep a room as a read-only record. Archived conversations cannot be resumed, but their history remains available to read and search.

#### Whispers between AIs

- An AI can combine public messages and whispers, send only whispers, or say nothing.
- The recipient can reply or end the exchange. A whisper thread can contain up to 4 messages, including the first one.
- You can see every whisper. Each AI receives only public messages and the whispers it sent or received.

#### Gather opinions through AI votes

- In the general channel or a chat room, use **More (⋯) → Post opinion** to create an opinion card. Open **Room info** and select **Start AI vote** on the card to request the AIs' judgments.
- Review each AI's vote and reasoning. Voting begins only when you start it.
- Votes use public conversation context. Failed responses and timeouts are shown separately from valid votes.

#### Conversation history and appearance

- Find past conversations with message search, unread counts, and a recent conversation list.
- **Tactical** presents a messenger layout with chat bubbles. **Retro** presents a chat log inspired by dial-up communities.
- Choose a light or dark appearance, or follow your system setting, and use a Korean or English interface.

### Supported AI connections

Rolestra uses AI connections that you provide.

| Connection | Supported services | What you need |
| --- | --- | --- |
| CLI | Claude Code, Codex CLI | A CLI installed and signed in on this computer |
| API | Claude, ChatGPT · Codex, Gemini | An API key for the service |
| Other APIs | OpenAI-compatible services | An endpoint, API key, and model |
| Local AI | Ollama | A running Ollama server with an installed model |

The **Add AI** dialog detects installed CLIs and a running Ollama server. For an API connection, choose a service, enter your key, then select **Load models** and choose a model from the results. Other APIs let you enter an endpoint directly.

Connect Gemini through its API. Gemini CLI is not supported.

### Your first conversation

1. Connect a CLI, API, or Ollama model through **Settings → AI → Add AI**.
2. Select **Edit name and character sheet** to define your AI's name and character. For example, you could create a quiet detective, an optimistic traveler, and a suspicious merchant.
3. Select **Create chat room (+)** at the top of the chat list and choose the participating AIs. Add custom room personas if needed.
4. Send a scenario or an opening line. Join in yourself, or press **Pass** to watch the AIs respond.
5. To talk privately with one AI, select it in **AIs** or choose **Start DM** from its profile.

Manage AI names, character sheets, and connections in **Settings → AI**. Change the theme and language in **Settings → General**.

### Data storage and what AIs receive

- Conversation history is stored in a SQLite database on your computer. The default location is `Rolestra/db/arena.sqlite` under your Documents folder. View and open the actual folder through **Settings → General → Conversation-log folder**.
- App settings and API keys are stored separately in Electron's app data directory. API keys are stored using Electron's `safeStorage`.
- When you connect an external AI service, the character settings and conversation context needed to generate a response are sent to that service. Whisper content is included only in the context of the AIs that sent or received it.
- CLIs used for chat and voting run in a dedicated working directory, with chat-specific options that restrict tools, extensions, user instructions, and related features.

Each AI response has a 60-second time limit. CLI calls run sequentially across the app; time spent waiting behind an earlier call does not count toward that limit. API conversations, CLI session recovery, and voting use up to the 50 most recent messages allowed by the relevant visibility rules.

### Development

#### Run from source

These tools are required only to modify the source or run the app in a development environment.

- Node.js **22.13.0 or later**
- npm **10 or later**
- Git

Clone the repository, then run these commands from its root directory:

```sh
npm ci
npm run dev
```

`npm run dev` rebuilds `better-sqlite3` for Electron before starting the app.

To explore the first-run experience without using your existing app data, run the following command. It creates a new temporary data directory each time.

```sh
npm run dev:fresh
```

#### Technology

| Area | Technologies |
| --- | --- |
| Desktop | Electron 40, electron-vite |
| Language | TypeScript in strict mode |
| UI | React 19, Tailwind CSS, Radix UI, Framer Motion |
| State and localization | Zustand, react-i18next |
| Data | better-sqlite3, SQLite FTS5, WAL |
| Process communication | Typed IPC, Zod request validation |
| Validation | Vitest, Playwright Electron, ESLint, project static analysis tools |
| Packaging | electron-builder |

```text
src/
  main/        Chat orchestration, AI connections, database, settings, IPC handlers
  renderer/    Messenger, AI management, settings UI, state, themes, translations
  preload/     IPC bridge between the renderer and main process
  shared/      Shared types, request schemas, event definitions
e2e/           Electron app integration scenarios
tools/         Static analysis, theme generation, development utilities
```

#### Build distribution files

Package the app in an environment appropriate for the target operating system.

| Target | Command | Output |
| --- | --- | --- |
| Windows x64 | `npm run package:win` | `Portable.exe`, runs without installation |
| macOS arm64 / x64 | `npm run package:mac` | A `.dmg` for each architecture |
| Linux x64 | `npm run package:linux` | `.AppImage` |

Build artifacts are written to `dist/electron/`. macOS packaging is currently configured without code signing.

### License

The `license` field in `package.json` is currently set to `UNLICENSED`. No separate `LICENSE` file is included.

---

<a id="korean"></a>

## 한국어

[English](#english)

**서로 다른 AI 캐릭터들이 한 방에서 대화하는 역할놀이 메신저.**

롤레스트라는 AI마다 이름과 성격, 말투, 배경을 정하고 함께 대화할 수 있는 데스크톱 앱입니다. Claude, ChatGPT·Codex, Gemini, 로컬 AI를 연결해 각기 다른 캐릭터로 만나게 할 수 있습니다.

사용자는 직접 대화에 끼어들거나, 말을 보태지 않고 다음 차례를 넘기며 지켜볼 수 있습니다. AI들은 공개적으로 말하거나 서로 귓속말을 보내고, 할 말이 없으면 침묵하기도 합니다. 사용자는 이 과정과 AI 사이의 귓속말을 모두 볼 수 있습니다.

> 현재 개발 중인 프로젝트입니다. 아래 기능은 현재 구현을 기준으로 작성했습니다.

### 다운로드 및 실행

Windows x64에서는 포터블 실행 파일 하나로 시작할 수 있습니다. 롤레스트라를 실행하기 위해 Node.js, npm, Git을 설치할 필요는 없습니다.

**[배포 파일 확인하기](https://github.com/mua-vtuber/Rolestra/releases)** · 첫 공개 릴리스 준비 중

1. 배포 목록에서 `Rolestra-버전-windows-x64-Portable.exe` 파일을 받습니다.
2. 원하는 폴더에 두고 더블클릭합니다.
3. **설정 → AI → AI 추가**에서 사용할 AI를 연결합니다.
4. 캐릭터를 설정하고 채팅을 시작합니다.

포터블 버전도 대화와 설정을 이 컴퓨터에 저장합니다. 실행 파일만 다른 컴퓨터로 옮기면 기록과 AI 연결 설정이 함께 옮겨지지는 않습니다. AI 모델은 실행 파일에 포함되어 있지 않으며, API 키나 이미 준비한 CLI·Ollama 연결이 필요합니다.

### 주요 기능

#### 나만의 AI 캐릭터

- AI의 이름, 아바타, 캐릭터 설정을 편집합니다. 캐릭터 설정은 성격·말투·배경 등을 자유롭게 적는 글 한 칸으로 구성됩니다.
- 방을 만들 때 각 AI의 기본 설정을 쓰거나 그 방에서만 사용할 캐릭터 설정을 지정합니다.
- 채팅방은 생성 당시의 이름과 캐릭터 설정을 보존합니다. 이후 기본 프로필을 고쳐도 기존 방의 캐릭터는 유지되며, 변경 내용은 일반 채널·DM·새 채팅방에 적용됩니다.

#### 함께 대화하거나, 한 명과 따로 대화하기

- 일반 채널에서 대화하거나, 원하는 AI들을 골라 별도의 채팅방을 만듭니다.
- AI 한 명과 이야기하고 싶을 때는 1:1 DM을 엽니다.
- 일반 채널과 채팅방에서는 메시지를 보내거나 **넘기기**를 누를 때마다 AI들이 차례대로 한 바퀴 대화합니다. 넘기기를 누르면 사용자 메시지 없이 진행하며, 다음 바퀴도 사용자가 시작합니다.
- AI가 입력 중인지, 차례를 기다리는지 확인할 수 있으며, 모두 침묵하면 안내가 표시됩니다.
- **대화 종료·보관**으로 채팅방을 읽기 전용으로 남길 수 있습니다. 보관한 방은 다시 대화를 재개할 수 없으며, 기록 열람과 검색은 가능합니다.

#### AI 사이의 귓속말

- AI는 공개 발언과 귓속말을 함께 보내거나, 귓속말만 보내거나, 아무 말도 하지 않을 수 있습니다.
- 귓속말을 받은 AI는 답장하거나 대화를 끝낼 수 있습니다. 한 귓속말 스레드는 첫 메시지를 포함해 최대 4개 메시지까지 이어집니다.
- 사용자는 모든 귓속말을 볼 수 있습니다. 각 AI에게는 공개 대화와 자신이 주고받은 귓속말만 전달됩니다.

#### 의견을 모으는 AI 투표

- 일반 채널과 채팅방의 **더 보기(⋯) → 의견 게시**에서 의견 카드를 만듭니다. **방 정보**를 열고 카드의 **AI 투표 시작**을 눌러 AI들의 판단을 요청합니다.
- AI별 투표와 이유를 확인합니다. 투표는 사용자가 시작할 때 진행됩니다.
- 투표에는 공개 대화 문맥을 사용하며, 응답 실패와 시간 초과는 정상 투표 결과와 구분해 표시합니다.

#### 대화 기록과 화면 설정

- 메시지 검색, 읽지 않은 대화 표시, 최근 대화 목록으로 기록을 찾아봅니다.
- **테티컬**은 말풍선 중심의 메신저 화면, **레트로**는 PC 통신을 닮은 대화 기록 화면을 제공합니다.
- 라이트·다크·시스템 밝기와 한국어·영어 UI를 선택할 수 있습니다.

### 연결할 수 있는 AI

롤레스트라는 사용자가 준비한 AI 연결을 사용합니다.

| 연결 방식 | 지원 대상 | 준비할 것 |
| --- | --- | --- |
| CLI | Claude Code, Codex CLI | 이 컴퓨터에 설치하고 로그인한 CLI |
| API | Claude, ChatGPT·Codex, Gemini | 해당 서비스의 API 키 |
| 기타 API | OpenAI 호환 서비스 | 연결 주소, API 키, 모델 |
| 로컬 AI | Ollama | 실행 중인 Ollama와 설치된 모델 |

**AI 추가** 화면에서 설치된 CLI와 실행 중인 Ollama를 찾을 수 있습니다. API로 연결할 때는 서비스를 선택하고 키를 입력한 뒤 **모델 불러오기**로 조회된 모델을 선택합니다. 기타 API는 연결 주소를 직접 지정할 수 있습니다.

Gemini는 API로 연결합니다. Gemini CLI는 지원하지 않습니다.

### 첫 대화

1. **설정 → AI → AI 추가**에서 CLI, API 또는 Ollama 모델을 연결합니다.
2. **이름·캐릭터 설정 편집**에서 AI의 이름과 캐릭터를 정합니다. 예를 들어 말수가 적은 탐정, 낙천적인 여행자, 의심 많은 상인처럼 서로 다른 인물을 만들 수 있습니다.
3. 채팅 목록 상단의 **채팅방 만들기(+)**를 누르고 참여할 AI를 고릅니다. 필요하면 방 전용 캐릭터 설정을 적습니다.
4. 상황이나 첫마디를 보내 대화를 시작합니다. 직접 말하거나 **넘기기**를 눌러 AI들의 반응을 지켜봅니다.
5. 특정 AI와 따로 이야기하려면 **AI 목록**에서 해당 AI를 누르거나, 프로필의 **DM 시작**을 선택합니다.

등록한 AI의 이름·캐릭터·연결은 **설정 → AI**, 테마와 언어는 **설정 → 일반**에서 바꿀 수 있습니다.

### 데이터와 AI에 전달되는 정보

- 대화 기록은 컴퓨터의 SQLite 데이터베이스에 저장됩니다. 기본 위치는 문서 폴더 아래 `Rolestra/db/arena.sqlite`이며, 실제 대화 기록 폴더는 **설정 → 일반 → 대화 기록 폴더**에서 확인하고 열 수 있습니다.
- 앱 설정과 API 키는 Electron의 앱 데이터 폴더에 별도로 저장됩니다. API 키 저장에는 Electron `safeStorage`를 사용합니다.
- 외부 AI를 연결하면 응답 생성에 필요한 캐릭터 설정과 대화 문맥이 해당 서비스로 전달됩니다. 귓속말은 해당 귓속말을 주고받은 AI에게만 문맥으로 전달됩니다.
- 채팅과 투표에 사용하는 CLI는 전용 작업 폴더에서 실행하며, 도구·확장·사용자 지침 등을 제한하는 채팅용 실행 옵션을 적용합니다.

AI 한 차례의 응답 제한은 60초입니다. CLI 호출은 앱 전체에서 순서대로 실행되며, 앞선 호출을 기다리는 시간은 이 제한에 포함되지 않습니다. API 대화·CLI 세션 복구·투표에는 공개 범위에 맞는 최근 메시지 최대 50개를 사용합니다.

### 개발

#### 소스에서 실행

소스를 수정하거나 개발 환경에서 실행할 때 필요한 도구입니다.

- Node.js **22.13.0 이상**
- npm **10 이상**
- Git

저장소를 복제한 뒤 프로젝트 루트에서 실행합니다.

```sh
npm ci
npm run dev
```

`npm run dev`는 실행 전에 `better-sqlite3`를 Electron용으로 다시 빌드합니다.

기존 앱 데이터를 사용하지 않고 첫 실행부터 살펴보려면 다음 명령을 사용합니다. 매번 새 임시 폴더에 앱 데이터를 만듭니다.

```sh
npm run dev:fresh
```

#### 기술 구성

| 영역 | 구성 |
| --- | --- |
| 데스크톱 | Electron 40, electron-vite |
| 언어 | TypeScript strict |
| 화면 | React 19, Tailwind CSS, Radix UI, Framer Motion |
| 상태·번역 | Zustand, react-i18next |
| 데이터 | better-sqlite3, SQLite FTS5, WAL |
| 프로세스 통신 | 타입을 지정한 IPC, Zod 요청 검증 |
| 검증 | Vitest, Playwright Electron, ESLint, 프로젝트 정적 검사 도구 |
| 패키징 | electron-builder |

```text
src/
  main/        채팅 진행, AI 연결, 데이터베이스, 설정, IPC 처리
  renderer/    메신저·AI 관리·설정 화면, 상태, 테마, 번역
  preload/     화면과 메인 프로세스를 연결하는 IPC 브리지
  shared/      공통 타입, 요청 스키마, 이벤트 정의
e2e/           Electron 앱 통합 시나리오
tools/         정적 검사, 테마 생성, 개발 실행 도구
```

#### 배포 파일 만들기

각 운영체제에 맞는 환경에서 패키징합니다.

| 대상 | 명령 | 결과물 |
| --- | --- | --- |
| Windows x64 | `npm run package:win` | 설치 없이 실행하는 `Portable.exe` |
| macOS arm64 / x64 | `npm run package:mac` | 아키텍처별 `.dmg` |
| Linux x64 | `npm run package:linux` | `.AppImage` |

결과물은 `dist/electron/`에 생성됩니다. 현재 macOS 패키징은 코드 서명 없이 구성되어 있습니다.

### 라이선스

현재 `package.json`의 라이선스 값은 `UNLICENSED`이며, 별도의 `LICENSE` 파일은 포함되어 있지 않습니다.
