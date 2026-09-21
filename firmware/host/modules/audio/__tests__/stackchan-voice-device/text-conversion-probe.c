#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "aqk2r.h"

static unsigned char *dictionary;
static size_t dictionary_size;
size_t aqdic_open(void) { return dictionary ? 4 : 0; }
size_t aqdic_read(size_t pos, size_t size, void *out) {
    if (pos < 4 || pos - 4 > dictionary_size || size > dictionary_size - (pos - 4)) return 0;
    memcpy(out, dictionary + pos - 4, size);
    return size;
}
void aqdic_close(void) {}

int main(int argc, char **argv) {
    const char *cases[] = {
        "明日は１４日に行ってください",
        "明日は14日に行ってください",
        "明日はじゅうよっかに行ってください",
        "あしたはじゅうよっかにいってください",
        "「明日は１４日に行ってください」",
        "明日は１４日に行ってください！",
        "明日は１４日に行ってください😊",
        " 明日はじゅうよっかに行ってください "
    };
    const unsigned int expected[] = {0, 0, 0, 0, 105, 0, 105, 0};
    unsigned char work[SIZE_AQK2R_MIN_WORK_BUF];
    char reading[4096];
    FILE *file;
    unsigned int i;
    if (argc != 2 || !(file = fopen(argv[1], "rb"))) return 1;
    fseek(file, 0, SEEK_END);
    dictionary_size = (size_t)ftell(file);
    rewind(file);
    dictionary = malloc(dictionary_size);
    if (!dictionary || fread(dictionary, 1, dictionary_size, file) != dictionary_size) return 2;
    fclose(file);
    if (CAqK2R_Create(work, sizeof(work))) return 3;
    for (i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        unsigned int error = CAqK2R_Convert(cases[i], reading, sizeof(reading));
        printf("case %u: error=%u reading=%s\n", i, error, error ? "(failed)" : reading);
        if (error != expected[i]) return 4;
        if ((i == 2 || i == 7) && !strstr(reading, "juu/yokka")) return 5;
    }
    CAqK2R_Release();
    free(dictionary);
    return 0;
}
