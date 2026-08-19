import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFIJOS_TELEFONO,
  adivinarPaisId,
  adivinarTelefono,
  cuerpoDeCliente,
  interpretarRespuestaCliente,
  motivoParaNoCrearCliente,
  type DatosCliente,
} from './crearCliente.js';

function datos(over: Partial<DatosCliente> = {}): DatosCliente {
  return {
    nombre: 'Yess',
    apellido: 'Perez',
    paisId: '3',
    telefonoTipo: 'Personal',
    telefonoPrefijo: '+51',
    telefonoNumero: '912323036',
    ...over,
  };
}

test('motivoParaNoCrearCliente: nombre, apellido, país y teléfono son los únicos obligatorios', () => {
  assert.equal(motivoParaNoCrearCliente(datos({ nombre: '' })), 'Falta el nombre.');
  assert.equal(motivoParaNoCrearCliente(datos({ apellido: '' })), 'Falta el apellido.');
  assert.equal(motivoParaNoCrearCliente(datos({ paisId: '' })), 'Elegí el país.');
  assert.equal(motivoParaNoCrearCliente(datos({ telefonoTipo: '' })), 'Elegí el tipo de teléfono.');
  assert.equal(motivoParaNoCrearCliente(datos({ telefonoPrefijo: '+999' })), 'Elegí el prefijo del teléfono.');
  assert.equal(motivoParaNoCrearCliente(datos({ telefonoNumero: '123' })), 'El número de teléfono no es válido.');
  assert.equal(motivoParaNoCrearCliente(datos()), null);
});

test('motivoParaNoCrearCliente: fecha de nacimiento, DNI, tratamiento y ocupación NO son obligatorios', () => {
  assert.equal(motivoParaNoCrearCliente(datos()), null);
});

test('motivoParaNoCrearCliente: el correo es o los dos campos, o ninguno', () => {
  assert.equal(
    motivoParaNoCrearCliente(datos({ correo: { tipo: 'personal', valor: '' } })),
    'Completá el tipo y la dirección de correo, o dejá los dos vacíos.',
  );
  assert.equal(
    motivoParaNoCrearCliente(datos({ correo: { tipo: '', valor: 'a@b.com' } })),
    'Completá el tipo y la dirección de correo, o dejá los dos vacíos.',
  );
  assert.equal(motivoParaNoCrearCliente(datos({ correo: { tipo: 'personal', valor: 'a@b.com' } })), null);
});

test('adivinarPaisId: matchea por nombre normalizado contra la lista real de Cerberus', () => {
  const paises = [
    { id: '3', nombre: 'Perú' },
    { id: '5', nombre: 'México' },
  ];
  assert.equal(adivinarPaisId(paises, '51912323036'), '3');
  assert.equal(adivinarPaisId(paises, '5219876543210'), '5');
});

test('adivinarPaisId: sin match o sin país legible, null — nunca inventa uno', () => {
  const paises = [{ id: '3', nombre: 'Perú' }];
  assert.equal(adivinarPaisId(paises, '5219876543210'), null); // México, no está en la lista
  assert.equal(adivinarPaisId(paises, '123'), null); // no se deja partir
});

test('adivinarPaisId: un +1 (EE. UU./Canadá/Rep. Dominicana) nunca adivina país — son tres, no uno', () => {
  // Verificado contra los 31 países reales de tb_pais (18-ago-2026): sin esta
  // guarda, el gap dependía de que "EE. UU./Canadá" nunca matcheara ningún
  // nombre real por casualidad de string — acá se fija que es a propósito.
  const paises = [
    { id: '19', nombre: 'Estados Unidos' },
    { id: '22', nombre: 'Canadá' },
    { id: '11', nombre: 'República Dominicana' },
  ];
  assert.equal(adivinarPaisId(paises, '15551234567'), null);
});

test('adivinarTelefono: prefijo + local, sin el dígito heredado de México/Argentina', () => {
  assert.deepEqual(adivinarTelefono('51912323036'), { prefijo: '+51', numero: '912323036' });
  assert.deepEqual(adivinarTelefono('5219876543210'), { prefijo: '+52', numero: '9876543210' });
});

test('adivinarTelefono: no se deja partir, null', () => {
  assert.equal(adivinarTelefono('123'), null);
});

test('adivinarTelefono: un +1 sugiere el número, pero NUNCA el prefijo — son tres países, no uno', () => {
  // El número es confiable (los tres comparten largo nacional); el prefijo
  // preseleccionado mostraría siempre «Canadá (+1)» —la primera opción con
  // ese valor en PREFIJOS_TELEFONO— para lo que puede ser un cliente
  // estadounidense o dominicano. Mejor sin marcar que marcado mintiendo.
  assert.deepEqual(adivinarTelefono('15551234567'), { prefijo: null, numero: '5551234567' });
});

test('adivinarTelefono: todo código de país que Hermes conoce es un prefijo válido en Cerberus', () => {
  // La guarda que evita sugerir un valor que el <select> de Cerberus no tiene.
  const ejemplos = ['51912323036', '5219876543210', '593987654321', '5491122334455'];
  for (const e of ejemplos) {
    const t = adivinarTelefono(e);
    assert.ok(t, `esperaba poder partir ${e}`);
    assert.ok(PREFIJOS_TELEFONO.some((p) => p.id === t!.prefijo), `${t!.prefijo} no está en PREFIJOS_TELEFONO`);
  }
});

test('cuerpoDeCliente: los campos opcionales viajan vacíos si no se llenaron', () => {
  const body = cuerpoDeCliente({ csrf: 'tok', datos: datos() });
  assert.equal(body.get('nombre'), 'Yess');
  assert.equal(body.get('apellido'), 'Perez');
  assert.equal(body.get('pais'), '3');
  assert.equal(body.get('fecha_nacimiento'), '');
  assert.equal(body.get('dni'), '');
  assert.equal(body.get('tratamiento'), '');
  assert.equal(body.get('ocupacion'), '');
  assert.equal(body.get('telefono-TOTAL_FORMS'), '1');
  assert.equal(body.get('telefono-INITIAL_FORMS'), '0');
  assert.equal(body.get('telefono-0-tipo_telefono'), 'Personal');
  assert.equal(body.get('telefono-0-prefijo'), '+51');
  assert.equal(body.get('telefono-0-numero'), '912323036');
  assert.equal(body.get('correo-TOTAL_FORMS'), '0');
  assert.equal(body.get('correo-INITIAL_FORMS'), '0');
  assert.equal(body.get('correo-0-nombre_correo'), null); // ni se manda
});

test('cuerpoDeCliente: los campos opcionales llenos viajan tal cual', () => {
  const body = cuerpoDeCliente({
    csrf: 'tok',
    datos: datos({
      fechaNacimiento: '1998-04-02',
      dni: '45678912',
      tratamiento: 'Sr.',
      ocupacion: 'Consultor',
      correo: { tipo: 'personal', valor: 'yess@correo.com' },
    }),
  });
  assert.equal(body.get('fecha_nacimiento'), '1998-04-02');
  assert.equal(body.get('dni'), '45678912');
  assert.equal(body.get('tratamiento'), 'Sr.');
  assert.equal(body.get('ocupacion'), 'Consultor');
  assert.equal(body.get('correo-TOTAL_FORMS'), '1');
  assert.equal(body.get('correo-0-tipo_correo'), 'personal');
  assert.equal(body.get('correo-0-nombre_correo'), 'yess@correo.com');
});

test('interpretarRespuestaCliente: éxito trae el id nuevo', () => {
  assert.deepEqual(interpretarRespuestaCliente({ success: true, cliente_id: 13046 }), {
    ok: true,
    clienteId: 13046,
  });
});

test('interpretarRespuestaCliente: teléfono, correo y DNI duplicados se distinguen de un rechazo genérico', () => {
  // Los tres strings son el texto EXACTO que Cerberus devuelve — verificado
  // contra users/forms.py (TelefonoForm.clean_numero, CorreoForm y
  // ClienteForm.clean_dni). Un cambio de redacción allá deja este candado en
  // rojo, que es la señal de que hay que venir a actualizarlo acá.
  assert.deepEqual(
    interpretarRespuestaCliente({
      success: false,
      html: '<div>Este número ya está registrado por otro cliente.</div>',
    }),
    { ok: false, motivo: 'Ese teléfono ya está registrado en Cerberus a nombre de otro cliente.' },
  );
  assert.deepEqual(
    interpretarRespuestaCliente({
      success: false,
      html: '<div>Este correo ya está registrado por otro cliente.</div>',
    }),
    { ok: false, motivo: 'Ese correo ya está registrado en Cerberus a nombre de otro cliente.' },
  );
  assert.deepEqual(
    interpretarRespuestaCliente({
      success: false,
      html: '<div>Este DNI ya está registrado por otro cliente.</div>',
    }),
    { ok: false, motivo: 'Ese DNI ya está registrado en Cerberus a nombre de otro cliente.' },
  );
});

test('interpretarRespuestaCliente: sin señal reconocible, el motivo genérico — nunca inventa una causa', () => {
  assert.deepEqual(interpretarRespuestaCliente({ success: false, html: '<div>otra cosa</div>' }), {
    ok: false,
    motivo: 'Cerberus rechazó los datos — revisá los campos del formulario.',
  });
  assert.deepEqual(interpretarRespuestaCliente({}), {
    ok: false,
    motivo: 'Cerberus rechazó los datos — revisá los campos del formulario.',
  });
});
