import assert from "node:assert/strict";
import test from "node:test";
import { contarCancelaciones, vetoAlSalir, type EstadoAlSalir } from "./vetoAlSalir.js";

const quieto: EstadoAlSalir = {
  mensajes: ["Hola, informacion por favor"],
  escribioDesdeQueSeAutorizo: false,
  leEscribieronDesdeQueSeAutorizo: false,
  yaLeLlego: false,
};
const con = (p: Partial<EstadoAlSalir>): EstadoAlSalir => ({ ...quieto, ...p });

test("sin novedades, sale", () => {
  assert.deepEqual(vetoAlSalir(quieto), { sale: true });
});

test("EL CASO QUE ESTE ARCHIVO EXISTE PARA MATAR: dijo que no MIENTRAS el lote corria", () => {
  // A las 14:00 calificaba. A las 15:00 escribio «ya no me interesa». A las
  // 17:30 le tocaba el turno. Sin esta pregunta, recibe el flyer igual.
  const v = vetoAlSalir(
    con({
      mensajes: ["Hola, informacion", "ya no me interesa"],
      escribioDesdeQueSeAutorizo: true,
    }),
  );
  assert.deepEqual(v, { sale: false, motivo: "dijo_que_no" });
});

test("una conversacion viva no se interrumpe con una promo", () => {
  const v = vetoAlSalir(con({ escribioDesdeQueSeAutorizo: true }));
  assert.deepEqual(v, { sale: false, motivo: "conversacion_viva" });
});

test("si una vendedora ya le escribio, la campana llega tarde y de mas", () => {
  const v = vetoAlSalir(con({ leEscribieronDesdeQueSeAutorizo: true }));
  assert.deepEqual(v, { sale: false, motivo: "ya_le_escribieron" });
});

test("se despidio mientras esperaba su turno", () => {
  const v = vetoAlSalir(
    con({
      mensajes: ["hola", "agradezco mucho la atencion prestada"],
      escribioDesdeQueSeAutorizo: true,
    }),
  );
  assert.deepEqual(v, { sale: false, motivo: "se_despidio" });
});

test("un segundo mensaje identico no sale (corrida frenada y reanudada)", () => {
  assert.deepEqual(vetoAlSalir(con({ yaLeLlego: true })), { sale: false, motivo: "ya_le_llego" });
});

test("EL ORDEN DEL MOTIVO IMPORTA: el que se guarda tiene que ser defendible", () => {
  // Escribio Y dijo que no. Las dos cosas son verdad; «dijo que no» es la que
  // explica por que no le escribimos.
  const v = vetoAlSalir(
    con({
      mensajes: ["no me interesa"],
      escribioDesdeQueSeAutorizo: true,
      leEscribieronDesdeQueSeAutorizo: true,
      yaLeLlego: true,
    }),
  );
  assert.deepEqual(v, { sale: false, motivo: "dijo_que_no" });
});

test("un mensaje repetido pesa mas que una conversacion viva", () => {
  const v = vetoAlSalir(con({ yaLeLlego: true, escribioDesdeQueSeAutorizo: true }));
  assert.equal(v.sale, false);
  assert.equal(v.sale === false && v.motivo, "ya_le_llego");
});

test("contarCancelaciones lista los cinco motivos, con cero incluido", () => {
  const c = contarCancelaciones([
    { sale: true },
    { sale: false, motivo: "dijo_que_no" },
    { sale: false, motivo: "dijo_que_no" },
    { sale: false, motivo: "conversacion_viva" },
  ]);
  assert.equal(c.dijo_que_no, 2);
  assert.equal(c.conversacion_viva, 1);
  assert.equal(c.ya_le_llego, 0);
  assert.equal(c.se_despidio, 0);
});

test("el veto no depende de un reloj: se le pasa el estado, no la hora", () => {
  // Es lo que lo hace testeable sin fingir el tiempo, y lo que permite
  // preguntarlo dentro del bucle sin recalcular ventanas.
  const dosVeces = [vetoAlSalir(quieto), vetoAlSalir(quieto)];
  assert.deepEqual(dosVeces[0], dosVeces[1]);
});
