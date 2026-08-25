import { useState } from 'react';
import { getDisplayGameName, getGameCoverUrls } from './app-utils.js';

const BRAND_LOGO = '/hollowrun.svg';
const unavailableCoverUrls = new Set();

function GameCoverFallback({ game, displayName }) {
  const [iconUnavailable, setIconUnavailable] = useState(false);

  return (
    <div className="game-cover-fallback" role="img" aria-label={`No cover available for ${displayName}`}>
      {!iconUnavailable ? (
        <img
          src={`/api/steam-art/${game.appid}/icon`}
          alt=""
          aria-hidden="true"
          className="game-cover-icon"
          decoding="async"
          onError={() => setIconUnavailable(true)}
        />
      ) : (
        <img src={BRAND_LOGO} alt="" aria-hidden="true" className="game-cover-brand-logo" />
      )}
      <span className="game-cover-name">Artwork unavailable</span>
      <span className="game-cover-appid">AppID {game.appid}</span>
    </div>
  );
}

export function GameCover({ game }) {
  const displayName = getDisplayGameName(game);
  const [, retryCover] = useState(0);
  const coverUrl = getGameCoverUrls(game).find(url => !unavailableCoverUrls.has(url)) || '';

  if (!coverUrl) {
    return <GameCoverFallback game={game} displayName={displayName} />;
  }

  return (
    <img
      src={coverUrl}
      alt=""
      aria-hidden="true"
      className="game-image"
      loading="lazy"
      decoding="async"
      draggable="false"
      referrerPolicy="no-referrer"
      onError={() => {
        unavailableCoverUrls.add(coverUrl);
        retryCover(attempt => attempt + 1);
      }}
    />
  );
}

export function GameIcon({ appId, name }) {
  const [iconUnavailable, setIconUnavailable] = useState(false);

  return (
    <div className="task-icon-box">
      <img
        key={iconUnavailable ? 'fallback' : appId}
        src={iconUnavailable ? BRAND_LOGO : `/api/steam-art/${appId}/icon`}
        alt=""
        aria-hidden="true"
        className={`task-icon-image ${iconUnavailable ? 'fallback' : ''}`}
        title={name}
        onError={() => setIconUnavailable(true)}
      />
    </div>
  );
}
