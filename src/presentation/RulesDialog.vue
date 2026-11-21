<script setup lang="ts">
import {ENTITY_META} from '@/domain/game/rules';
import {EntityType} from '@/domain/game/types';
import {useGameStore} from '@/application/stores/useGameStore';
import ModalDialog from '@/components/ui/dialog/ModalDialog.vue';
import {Button} from '@/components/ui/button';

const store = useGameStore();

const UNIT_ROWS = [
  EntityType.PEASANT,
  EntityType.SPEARMAN,
  EntityType.BARON,
  EntityType.KNIGHT,
  EntityType.CATAPULT,
];
</script>

<template>
  <ModalDialog
    :open="store.showRulesDialog"
    title="Правила Antiyoy 3D"
    description="Экономика, катапульты, дипломатия, освещение и снос построек."
    content-class="w-[min(94vw,640px)] max-h-[86vh] overflow-y-auto"
    @update:open="(val) => (store.showRulesDialog = val)"
  >
    <div class="space-y-4 text-sm text-muted-foreground">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs leading-relaxed">
        <div class="rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
          <div class="font-semibold text-foreground">Экономика, посад и снос (25%)</div>
          <p>
            Свободный гекс приносит +1 монету, ферма +4. Торговый посад строится
            на 3 гексах поверх фермы и даёт +10 золота +2 за каждую соседнюю
            обычную ферму. Любую постройку (кроме столицы) можно снести (X) с
            возвратом 25%.
          </p>
        </div>
        <div class="rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
          <div class="font-semibold text-foreground">Катапульты (дистанция 2–3)</div>
          <p>
            Обстреливают видимые вражеские гексы на дистанции 2–3 (не бьют по
            соседним клеткам): сносят башни, фермы и посады, ослабляют цитадели
            и понижают ранг воинов врага.
          </p>
        </div>
        <div class="rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
          <div class="font-semibold text-foreground">Освещение и туман войны</div>
          <p>
            Стройте Сигнальный маяк (обзор 5 гексов) или запускайте «Свет» (F, 8
            монет) в любую тёмную точку карты, чтобы видеть земли, где вас нет.
          </p>
        </div>
        <div class="rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
          <div class="font-semibold text-foreground">Дипломатия и Чёрная метка</div>
          <p>
            Заключайте союзы, объявляйте войну (для атак), выкупайте пограничные
            земли, пересылайте золото и выставляйте Чёрную метку вероломным
            соперникам.
          </p>
        </div>
      </div>

      <div class="overflow-hidden rounded-lg border border-border">
        <table class="w-full text-left text-xs">
          <thead class="bg-secondary/60 text-muted-foreground">
            <tr>
              <th class="px-3 py-2 font-medium">Юнит</th>
              <th class="px-3 py-2 font-medium text-right">Сила</th>
              <th class="px-3 py-2 font-medium text-right">Защита</th>
              <th class="px-3 py-2 font-medium text-right">Цена</th>
              <th class="px-3 py-2 font-medium text-right">Содержание</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border font-mono tabular-nums">
            <tr v-for="u in UNIT_ROWS" :key="u" class="text-foreground">
              <td class="px-3 py-1.5 font-sans font-medium">
                {{ ENTITY_META[u].label }}
              </td>
              <td class="px-3 py-1.5 text-right">{{ ENTITY_META[u].strength }}</td>
              <td class="px-3 py-1.5 text-right">{{ ENTITY_META[u].defense }}</td>
              <td class="px-3 py-1.5 text-right text-primary">
                {{ ENTITY_META[u].cost }}
              </td>
              <td class="px-3 py-1.5 text-right text-rose-300">
                -{{ ENTITY_META[u].upkeep }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex justify-end pt-1">
        <Button @click="store.showRulesDialog = false">Понятно</Button>
      </div>
    </div>
  </ModalDialog>
</template>
