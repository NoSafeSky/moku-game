/**
 * @file platform plugin — audio-pref persistence unit tests.
 *
 * Drives createPrefsHooks + rehydrateAudioPrefs against mock `require`-resolved
 * storage + audio spies. Covers: the write-back hooks write the right storage
 * keys; rehydrate applies stored mute/volume to audio; a fresh store leaves audio
 * untouched (config defaults).
 */
import { describe, expect, it } from "vitest";

import {
  CHANNELS,
  createPrefsHooks,
  MUTE_KEY,
  rehydrateAudioPrefs,
  VOLUME_PREFIX
} from "../../prefs";
import { makeMockAudio, makeMockStorage, makeRequire } from "../mock-portal";

describe("platform: createPrefsHooks (write-back)", () => {
  it("audio:muteChanged writes storage.set('audio.muted', muted)", () => {
    const storage = makeMockStorage();
    const hooks = createPrefsHooks({ require: makeRequire({ storage }) });

    hooks["audio:muteChanged"]({ muted: true });

    expect(storage.set).toHaveBeenCalledWith(MUTE_KEY, true);
  });

  it("audio:volumeChanged writes storage.set('audio.volume.<channel>', value)", () => {
    const storage = makeMockStorage();
    const hooks = createPrefsHooks({ require: makeRequire({ storage }) });

    hooks["audio:volumeChanged"]({ channel: "music", value: 0.5 });

    expect(storage.set).toHaveBeenCalledWith(`${VOLUME_PREFIX}music`, 0.5);
  });
});

describe("platform: rehydrateAudioPrefs", () => {
  it("applies stored mute + per-channel volumes to audio", () => {
    const store = new Map<string, unknown>([
      [MUTE_KEY, true],
      [`${VOLUME_PREFIX}master`, 0.4],
      [`${VOLUME_PREFIX}music`, 0.2]
    ]);
    const audio = makeMockAudio();
    const storage = makeMockStorage(store);

    rehydrateAudioPrefs({ require: makeRequire({ audio, storage }) });

    expect(audio.setMuted).toHaveBeenCalledWith(true);
    expect(audio.setVolume).toHaveBeenCalledWith("master", 0.4);
    expect(audio.setVolume).toHaveBeenCalledWith("music", 0.2);
    expect(audio.setVolume).not.toHaveBeenCalledWith("sfx", expect.anything());
  });

  it("leaves audio untouched on a fresh store (config defaults)", () => {
    const audio = makeMockAudio();
    const storage = makeMockStorage(); // empty

    rehydrateAudioPrefs({ require: makeRequire({ audio, storage }) });

    expect(audio.setMuted).not.toHaveBeenCalled();
    expect(audio.setVolume).not.toHaveBeenCalled();
  });

  it("persists exactly the three known channels", () => {
    expect(CHANNELS).toEqual(["master", "sfx", "music"]);
  });
});
