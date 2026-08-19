const BOT_URL = 'https://t.me/zrrguide_bot';

export function renderBot() {
  return `
    <section class="hero bot-hero">
      <div class="bot-hero__orb bot-hero__orb--one" aria-hidden="true"></div>
      <div class="bot-hero__orb bot-hero__orb--two" aria-hidden="true"></div>
      <div class="bot-hero__top">
        <div>
          <span class="eyebrow">Telegram // GUIDE SYSTEM</span>
          <h1 class="tl__title">Гайд-бот,<br><em>который всегда рядом</em></h1>
          <p class="bot-hero__lead">
            <strong>@zrrguide_bot</strong> — это понятная точка входа в игру для новичков
            и удобная база знаний для всех игроков. Открывай нужную информацию тогда,
            когда она действительно нужна, без долгих поисков по чатам.
          </p>
        </div>
        <div class="bot-hero__signal" aria-hidden="true">
          <span>TG</span>
          <i></i><i></i><i></i>
        </div>
      </div>
      <div class="bot-hero__bottom">
        <div class="bot-stat"><b>1</b><span>Открой бота</span></div>
        <div class="bot-stat"><b>2</b><span>Выбери тему</span></div>
        <div class="bot-stat"><b>3</b><span>Разберись и играй увереннее</span></div>
      </div>
    </section>

    <section class="bot-launch panel">
      <div class="bot-launch__mark" aria-hidden="true"><span>✦</span></div>
      <div class="bot-launch__copy">
        <span class="eyebrow">Доступ открыт</span>
        <h2>Начни с простого</h2>
        <p>
          Не нужно знать все механики заранее. Бот поможет сориентироваться,
          понять основы и постепенно перейти к более полезным игровым решениям.
        </p>
        <a class="bot-cta" href="${BOT_URL}" target="_blank" rel="noopener noreferrer">
          <span>Открыть бота в Telegram</span><b>↗</b>
        </a>
      </div>
      <div class="bot-launch__handle">@zrrguide_bot</div>
    </section>

    <section class="bot-section">
      <header class="panel__head bot-section__head">
        <span class="eyebrow">Что внутри</span>
        <h2>Помощь без лишнего шума</h2>
        <p>Коротко, по делу и с возможностью возвращаться к нужной информации в любой момент.</p>
      </header>
      <div class="bot-feature-grid">
        <article class="bot-feature bot-feature--accent">
          <span class="bot-feature__index">01</span>
          <div class="bot-feature__icon">↗</div>
          <h3>Первые шаги</h3>
          <p>Подсказки для тех, кто только начинает разбираться в игре, сервере и важных игровых процессах.</p>
        </article>
        <article class="bot-feature">
          <span class="bot-feature__index">02</span>
          <div class="bot-feature__icon">◈</div>
          <h3>Понятные гайды</h3>
          <p>Сложные вещи разложены человеческим языком — без перегруженных инструкций и лишней теории.</p>
        </article>
        <article class="bot-feature">
          <span class="bot-feature__index">03</span>
          <div class="bot-feature__icon">⌁</div>
          <h3>Полезно каждому</h3>
          <p>Бот пригодится новичку, опытному игроку и тем, кто хочет быстро освежить знания перед важным решением.</p>
        </article>
        <article class="bot-feature">
          <span class="bot-feature__index">04</span>
          <div class="bot-feature__icon">+</div>
          <h3>Проект развивается</h3>
          <p>Новая информация добавляется постепенно, поэтому гайд-бот становится полезнее вместе с игрой.</p>
        </article>
      </div>
    </section>

    <section class="bot-promise panel">
      <div class="bot-promise__line" aria-hidden="true"></div>
      <div>
        <span class="eyebrow">Философия</span>
        <h2>Не оставаться один на один с непонятной механикой</h2>
      </div>
      <p>
        Хороший гайд не играет вместо тебя. Он даёт опору: объясняет, с чего начать,
        помогает не потеряться и оставляет тебе возможность самому выбрать лучший путь.
        Именно для этого создан <strong>zrrguide_bot</strong>.
      </p>
    </section>

    <section class="bot-final">
      <span class="eyebrow">Server 33 // companion</span>
      <h2>Сохрани бота.<br><em>Он ещё пригодится.</em></h2>
      <a class="bot-cta bot-cta--large" href="${BOT_URL}" target="_blank" rel="noopener noreferrer">
        Перейти к @zrrguide_bot <b>↗</b>
      </a>
    </section>`;
}
