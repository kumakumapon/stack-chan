#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>

// The simulator keeps Pet growth in browser storage, independently of its
// IndexedDB MOD archive. Other simulated preferences retain their prior
// in-memory behavior.
void xs_stackchan_wasm_pet_preference_get(xsMachine* the)
{
	char* value = (char*)EM_ASM_PTR({
		try {
			const saved = globalThis.localStorage?.getItem('stackchan.pet.state.v1');
			if (saved == null)
				return 0;
			const length = lengthBytesUTF8(saved) + 1;
			const pointer = _malloc(length);
			if (!pointer)
				return 0;
			stringToUTF8(saved, pointer, length);
			return pointer;
		} catch {
			return 0;
		}
	});
	if (!value) {
		xsmcSetNull(xsResult);
		return;
	}
	xsmcSetString(xsResult, value);
	free(value);
}

void xs_stackchan_wasm_pet_preference_set(xsMachine* the)
{
	const char* value = xsmcToString(xsArg(0));
	EM_ASM({
		try {
			globalThis.localStorage?.setItem('stackchan.pet.state.v1', UTF8ToString($0));
		} catch {
			// The XS in-memory value remains usable if browser storage is disabled.
		}
	}, value);
}

void xs_stackchan_wasm_pet_preference_delete(xsMachine* the)
{
	EM_ASM({
		try {
			globalThis.localStorage?.removeItem('stackchan.pet.state.v1');
		} catch {
		}
	});
}

// Timer state has its own allowlisted key. Unlike the legacy Pet bridge,
// failures propagate so the Mini App can explain that reboot recovery is lost.
void xs_stackchan_wasm_focus_preference_get(xsMachine* the)
{
	char* value = (char*)EM_ASM_PTR({
		try {
			const saved = globalThis.localStorage.getItem('stackchan.focus.state.v1');
			if (saved == null) return 0;
			const pointer = _malloc(lengthBytesUTF8(saved) + 1);
			if (!pointer) return 1;
			stringToUTF8(saved, pointer, lengthBytesUTF8(saved) + 1);
			return pointer;
		} catch {
			return 1;
		}
	});
	if (value == (char*)1) xsUnknownError("timer storage unavailable");
	if (!value) {
		xsmcSetNull(xsResult);
		return;
	}
	xsmcSetString(xsResult, value);
	free(value);
}

void xs_stackchan_wasm_focus_preference_set(xsMachine* the)
{
	const char* value = xsmcToString(xsArg(0));
	int failed = EM_ASM_INT({
		try {
			globalThis.localStorage.setItem('stackchan.focus.state.v1', UTF8ToString($0));
			return 0;
		} catch {
			return 1;
		}
	}, value);
	if (failed) xsUnknownError("timer save failed");
}

void xs_stackchan_wasm_focus_preference_delete(xsMachine* the)
{
	int failed = EM_ASM_INT({
		try {
			globalThis.localStorage.removeItem('stackchan.focus.state.v1');
			return 0;
		} catch {
			return 1;
		}
	});
	if (failed) xsUnknownError("timer delete failed");
}

// A closed allowlist keeps daily app state separate from Pet, timer and other settings.
static int dailyPreferenceIndex(xsMachine* the)
{
	int index = xsmcToInteger(xsArg(0));
	if (index < 0 || index > 1) xsRangeError("invalid daily app");
	return index;
}

void xs_stackchan_wasm_daily_preference_get(xsMachine* the)
{
	int index = dailyPreferenceIndex(the);
	char* value = (char*)EM_ASM_PTR({
		try {
			const key = $0 === 0 ? 'stackchan.quest.state.v1' : 'stackchan.quiz.state.v1';
			const saved = globalThis.localStorage.getItem(key);
			if (saved == null) return 0;
			if (saved.length > 4096) return 1;
			const length = lengthBytesUTF8(saved) + 1;
			const pointer = _malloc(length);
			if (!pointer) return 1;
			stringToUTF8(saved, pointer, length);
			return pointer;
		} catch {
			return 1;
		}
	}, index);
	if (value == (char*)1) xsUnknownError("daily app storage unavailable");
	if (!value) {
		xsmcSetNull(xsResult);
		return;
	}
	xsmcSetString(xsResult, value);
	free(value);
}

void xs_stackchan_wasm_daily_preference_set(xsMachine* the)
{
	int index = dailyPreferenceIndex(the);
	const char* value = xsmcToString(xsArg(1));
	int failed = EM_ASM_INT({
		try {
			const key = $0 === 0 ? 'stackchan.quest.state.v1' : 'stackchan.quiz.state.v1';
			globalThis.localStorage.setItem(key, UTF8ToString($1));
			return 0;
		} catch {
			return 1;
		}
	}, index, value);
	if (failed) xsUnknownError("daily app save failed");
}

void xs_stackchan_wasm_daily_preference_delete(xsMachine* the)
{
	int index = dailyPreferenceIndex(the);
	int failed = EM_ASM_INT({
		try {
			const key = $0 === 0 ? 'stackchan.quest.state.v1' : 'stackchan.quiz.state.v1';
			globalThis.localStorage.removeItem(key);
			return 0;
		} catch {
			return 1;
		}
	}, index);
	if (failed) xsUnknownError("daily app delete failed");
}

void xs_workshop_preference(xsMachine* the) {
  const char* json = xsmcToString(xsArg(0));
  char* result = (char*)EM_ASM_PTR({
    let result;
    try {
      const input = JSON.parse(UTF8ToString($0));
      const action = input.action; const domain = input.domain; const key = input.key; const value = input.value;
      if (!'sc_deck sc_workshop sc_inbox sc_activity sc_quiz'.split(' ').includes(domain) || !/^(state|meta|b[01]c[0-9][0-9]?)$/.test(key)) throw Error('Invalid workshop key');
      const name = 'stackchan.workshop.' + domain + '.' + key;
      if (action === 'set') {
        if (typeof value !== 'string' || value.length > 4096) throw Error('Workshop state too large');
        localStorage.setItem(name, value);
      } else if (action === 'delete') localStorage.removeItem(name);
      else if (action !== 'get') throw Error('Invalid storage action');
      const saved = action === 'get' ? localStorage.getItem(name) : null;
      if (saved && saved.length > 4096) throw Error('Workshop state too large');
      result = {value: saved};
    } catch { result = {error: 'Workshop storage unavailable'}; }
    const text = JSON.stringify(result);
    const pointer = _malloc(lengthBytesUTF8(text) + 1);
    if (pointer) stringToUTF8(text, pointer, lengthBytesUTF8(text) + 1);
    return pointer;
  }, json);
  if (!result) xsUnknownError("no memory");
  xsmcSetString(xsResult, result);
  free(result);
}
