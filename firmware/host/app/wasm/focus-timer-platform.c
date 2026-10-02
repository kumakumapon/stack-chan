#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_focus_now(xsMachine* the)
{
  xsmcSetNumber(xsResult, EM_ASM_DOUBLE({ return performance.now(); }));
}

void xs_stackchan_focus_hidden_at(xsMachine* the)
{
  double at = EM_ASM_DOUBLE({
    const at = stackchanRuntime.state.focusHiddenAt;
    delete stackchanRuntime.state.focusHiddenAt;
    return typeof at === 'number' ? at : -1;
  });
  xsmcSetNumber(xsResult, at);
}
