import { it, expect } from "vitest";

it("ambiente de teste de integração aponta para o banco efêmero, não para produção", () => {
  expect(process.env.DATABASE_URL).toMatch(/127\.0\.0\.1:\d+\/radar_test$/);
});
