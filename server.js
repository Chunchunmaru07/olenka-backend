const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer'); // <-- NUEVO: Para enviar correos
require('dotenv').config();
const db = require('./db');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// =========================================================================
// CONFIGURACIÓN DE NODEMAILER (ENVÍO DE CORREOS)
// =========================================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
});

// =========================================================================
// 1. ENDPOINTS DE AUTENTICACIÓN (LOGIN, REGISTRO Y APROBACIÓN)
// =========================================================================

// Inicio de Sesión
app.post('/api/login', async (req, res) => {
    const { correo, contrasena } = req.body;

    try {
        // Consulta a la tabla usuarios usando la nueva estructura
        const [filas] = await db.query(
            'SELECT * FROM usuarios WHERE correo = ?',
            [correo]
        );

        // Si el correo no existe
        if (filas.length === 0) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        const usuario = filas[0];

        // Verificación de contraseña
        if (usuario.password_hash !== contrasena) {
            return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
        }

        // Verificación de estado (para los trabajadores pendientes)
        if (usuario.estado === 'pendiente') {
            return res.status(403).json({ error: 'Tu cuenta está pendiente de aprobación por Administración.' });
        }

        // Retorna la sesión con el ROL del usuario
        res.json({
            id: String(usuario.id),
            correo: usuario.correo,
            nombre: usuario.nombre || usuario.correo,
            rol: usuario.rol
        });
    } catch (error) {
        console.error('Error en /api/login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Registro de Usuario
app.post('/api/registro', async (req, res) => {
    const { nombre, correo, telefono, rol, contrasena } = req.body;

    try {
        const [existe] = await db.query('SELECT correo FROM usuarios WHERE correo = ?', [correo]);
        if (existe.length > 0) {
            return res.status(400).json({ error: 'Este correo ya está registrado.' });
        }

        const estadoInicial = rol === 'trabajador' ? 'pendiente' : 'activo';

        const [resultado] = await db.query(
            'INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol, estado) VALUES (?, ?, ?, ?, ?, ?)',
            [nombre, correo, telefono || null, contrasena, rol, estadoInicial]
        );
        const id_usuario = resultado.insertId;

        if (rol === 'trabajador') {
            const mailOptions = {
                from: `"Sistema Olenka Y Ezis" <${process.env.MAIL_USER}>`,
                to: process.env.ADMIN_EMAIL,
                subject: '⚠️ Nueva Solicitud de Trabajador Pendiente',
                html: `
                    <h2 style="color: #d81b60;">Solicitud de Acceso - Personal de Mostrador</h2>
                    <p><strong>Nombre:</strong> ${nombre}</p>
                    <p><strong>Correo:</strong> ${correo}</p>
                    <p><strong>Teléfono:</strong> ${telefono || 'No proporcionado'}</p>
                    <br>
                    <a href="http://localhost:3000/api/aprobar-usuario/${id_usuario}"
                       style="background-color: #117A65; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                       ✅ Aprobar Trabajador
                    </a>
                `
            };
            transporter.sendMail(mailOptions, (err) => {
                if (err) console.error('Error enviando alerta al admin:', err);
            });
        }

        res.status(201).json({ mensaje: 'Cuenta creada exitosamente.' });
    } catch (error) {
        console.error('Error en /api/registro:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Aprobación rápida vía enlace de correo
app.get('/api/aprobar-usuario/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        await db.query("UPDATE usuarios SET estado = 'activo' WHERE id = ?", [userId]);
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #117A65;">✅ ¡Trabajador Aprobado!</h1>
                <p>El perfil de <strong>${userId}</strong> ha sido activado con éxito en el sistema.</p>
                <p>Ya puede iniciar sesión en la aplicación de mostrador.</p>
            </div>
        `);
    } catch (error) {
        res.status(500).send('<h1 style="color: #C0392B; text-align: center; padding: 50px;">❌ Error al aprobar usuario.</h1>');
    }
});

// =========================================================================
// 2. ENDPOINTS DE PRODUCTOS (CATÁLOGO)
// =========================================================================

// Obtener todos los productos
app.get('/api/productos', async (req, res) => {
    try {
        const [productos] = await db.query('SELECT * FROM productos ORDER BY id DESC');
        res.json(productos);
    } catch (error) {
        console.error('Error en GET /api/productos:', error);
        res.status(500).json({ mensaje: 'Error al obtener productos' });
    }
});

// Agregar nuevo producto (Admin)
app.post('/api/productos', async (req, res) => {
    const { nombre, categoria, descripcion, sabor, precio, stock, imagen, badge, porciones } = req.body;
    const id = 'prod-' + Date.now();

    try {
        await db.query(
            `INSERT INTO productos (id, nombre, categoria, descripcion, sabor, precio, stock, imagen, badge, porciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, nombre, categoria, descripcion, sabor, precio, stock, imagen, badge || null, porciones || null]
        );

        res.status(201).json({ id, ...req.body });
    } catch (error) {
        console.error('Error en POST /api/productos:', error);
        res.status(500).json({ mensaje: 'Error al crear producto' });
    }
});

// Actualizar Stock (Trabajador / Admin)
app.patch('/api/productos/:id/stock', async (req, res) => {
    const { id } = req.params;
    const { stock } = req.body;

    try {
        await db.query('UPDATE productos SET stock = ? WHERE id = ?', [stock, id]);
        const [actualizado] = await db.query('SELECT * FROM productos WHERE id = ?', [id]);
        res.json(actualizado[0]);
    } catch (error) {
        console.error('Error en PATCH /api/productos/:id/stock:', error);
        res.status(500).json({ mensaje: 'Error al actualizar stock' });
    }
});

// Actualizar Precio (Admin)
app.patch('/api/productos/:id/precio', async (req, res) => {
    const { id } = req.params;
    const { precio } = req.body;

    try {
        await db.query('UPDATE productos SET precio = ? WHERE id = ?', [precio, id]);
        const [actualizado] = await db.query('SELECT * FROM productos WHERE id = ?', [id]);
        res.json(actualizado[0]);
    } catch (error) {
        console.error('Error en PATCH /api/productos/:id/precio:', error);
        res.status(500).json({ mensaje: 'Error al actualizar precio' });
    }
});

// Eliminar Producto (Admin)
app.delete('/api/productos/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await db.query('DELETE FROM productos WHERE id = ?', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error en DELETE /api/productos/:id:', error);
        res.status(500).json({ mensaje: 'Error al eliminar producto' });
    }
});

// =========================================================================
// 3. ENDPOINTS DE VENTAS Y FACTURACIÓN
// =========================================================================

// Obtener todas las ventas
app.get('/api/ventas', async (req, res) => {
    try {
        const [ventas] = await db.query('SELECT * FROM ventas ORDER BY fecha DESC');
        // Mapear items si están guardados como JSON string
        const resultado = ventas.map(v => ({
            ...v,
            items: typeof v.items === 'string' ? JSON.parse(v.items) : v.items,
            facturado: Boolean(v.facturado)
        }));
        res.json(resultado);
    } catch (error) {
        console.error('Error en GET /api/ventas:', error);
        res.status(500).json({ mensaje: 'Error al obtener ventas' });
    }
});

// Registrar una nueva venta
app.post('/api/ventas', async (req, res) => {
    const { items, trabajadorId, trabajadorNombre, metodoPago } = req.body;

    const total = items.reduce((acc, i) => acc + i.importe, 0);
    const subtotal = Math.round((total / 1.16) * 100) / 100;
    const iva = Math.round((total - subtotal) * 100) / 100;
    const folio = 'TK-' + Math.floor(1000 + Math.random() * 9000);
    const fecha = new Date().toISOString();

    try {
        await db.query(
            `INSERT INTO ventas (folio, fecha, trabajadorId, trabajadorNombre, items, subtotal, iva, total, facturado, metodoPago)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folio, fecha, trabajadorId, trabajadorNombre, JSON.stringify(items), subtotal, iva, total, false, metodoPago]
        );

        const nuevaVenta = {
            folio, fecha, trabajadorId, trabajadorNombre, items, subtotal, iva, total, facturado: false, metodoPago
        };

        res.status(201).json(nuevaVenta);
    } catch (error) {
        console.error('Error en POST /api/ventas:', error);
        res.status(500).json({ mensaje: 'Error al registrar la venta' });
    }
});

// Obtener todas las facturas
app.get('/api/facturas', async (req, res) => {
    try {
        const [facturas] = await db.query('SELECT * FROM facturas ORDER BY fechaEmision DESC');
        const resultado = facturas.map(f => ({
            ...f,
            items: typeof f.items === 'string' ? JSON.parse(f.items) : f.items
        }));
        res.json(resultado);
    } catch (error) {
        console.error('Error en GET /api/facturas:', error);
        res.status(500).json({ mensaje: 'Error al obtener facturas' });
    }
});

// Emitir una nueva factura SAT
app.post('/api/facturas', async (req, res) => {
    const { folioTicket, rfc, razonSocial, codigoPostal, regimenFiscal, usoCFDI, correo } = req.body;

    try {
        // 1. Buscar el ticket
        const [tickets] = await db.query('SELECT * FROM ventas WHERE folio = ?', [folioTicket]);
        if (tickets.length === 0) {
            return res.status(404).json({ mensaje: 'Ticket no encontrado' });
        }

        const ticket = tickets[0];
        const items = typeof ticket.items === 'string' ? JSON.parse(ticket.items) : ticket.items;
        const uuidSAT = '4A8F' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-A528-9842FBC91024';
        const folioFactura = 'FAC-2026-' + Math.floor(1000 + Math.random() * 9000);
        const fechaEmision = new Date().toISOString();

        // 2. Insertar factura
        await db.query(
            `INSERT INTO facturas (folioFactura, folioTicket, uuidSAT, rfcReceptor, razonSocial, codigoPostal, regimenFiscal, usoCFDI, correo, fechaEmision, subtotal, iva, total, items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [folioFactura, folioTicket, uuidSAT, rfc, razonSocial, codigoPostal, regimenFiscal, usoCFDI, correo, fechaEmision, ticket.subtotal, ticket.iva, ticket.total, JSON.stringify(items)]
        );

        // 3. Actualizar ticket a facturado
        await db.query('UPDATE ventas SET facturado = true, uuidFactura = ? WHERE folio = ?', [uuidSAT, folioTicket]);

        const nuevaFactura = {
            folioFactura, folioTicket, uuidSAT, rfcReceptor: rfc, razonSocial, codigoPostal, regimenFiscal, usoCFDI, correo, fechaEmision, subtotal: ticket.subtotal, iva: ticket.iva, total: ticket.total, items
        };

        res.status(201).json(nuevaFactura);
    } catch (error) {
        console.error('Error en POST /api/facturas:', error);
        res.status(500).json({ mensaje: 'Error al emitir factura' });
    }
});

console.log('✅ Rutas de pedidos cargadas');
const ESTADOS_PEDIDO = ['Pendiente', 'En Horno', 'Decorando', 'Listo', 'Entregado', 'Cancelado'];
const METODOS_ENTREGA = ['Sucursal', 'Domicilio'];

class ErrorNegocio extends Error { }

const aISO = (f) => (f ? new Date(f).toISOString() : '');

/** Consulta pedidos (con datos del cliente y sus productos) y los devuelve con la forma que usa Angular */
async function consultarPedidos(whereSql = '', params = []) {
    const [filas] = await db.query(
        `SELECT p.*, usuarios.nombre AS cliente_nombre, u.telefono AS cliente_telefono, u.correo AS cliente_email
         FROM pedidos p
        LEFT JOIN productos pr ON pr.id = lp.id_producto COLLATE utf8mb4_0900_ai_ci
         ${whereSql}
         ORDER BY p.fecha_pedido DESC`,
        params
    );
    if (filas.length === 0) return [];

    const [detalles] = await db.query(
        `SELECT lp.id_lista, lp.id_producto, lp.cantidad, lp.precio_unitario, lp.notas, pr.nombre
         FROM lista_productos lp
         LEFT JOIN productos pr ON pr.id = lp.id_producto
         WHERE lp.id_lista IN (?)
         ORDER BY lp.id_detalle`,
        [filas.map((f) => f.id_lista)]
    );

    const porLista = new Map();
    for (const d of detalles) {
        if (!porLista.has(d.id_lista)) porLista.set(d.id_lista, []);
        porLista.get(d.id_lista).push({
            productoId: d.id_producto,
            nombre: d.nombre || 'Producto eliminado',
            cantidad: Number(d.cantidad),
            precioUnitario: Number(d.precio_unitario),
            importe: Math.round(Number(d.precio_unitario) * Number(d.cantidad) * 100) / 100,
            notas: d.notas || undefined
        });
    }

    return filas.map((f) => ({
        id: 'PED-' + f.id_pedido,
        clienteId: String(f.id_cliente),
        clienteNombre: f.cliente_nombre || 'Cliente',
        clienteTelefono: f.cliente_telefono || '',
        clienteEmail: f.cliente_email || '',
        sucursalId: f.sucursal_id,
        sucursalNombre: f.sucursal_nombre,
        fechaCreacion: aISO(f.fecha_pedido),
        fechaEntregaEstimada: aISO(f.fecha_entrega_estimada),
        items: porLista.get(f.id_lista) || [],
        subtotal: Number(f.subtotal),
        costoEnvio: Number(f.costo_envio),
        total: Number(f.total),
        metodoEntrega: f.metodo_entrega,
        direccionEntrega: f.direccion_entrega || undefined,
        metodoPago: f.metodo_pago,
        estado: f.estado,
        notasEspeciales: f.notas_especiales || undefined
    }));
}

// Todos los pedidos (Administrador y Trabajadores)
app.get('/api/pedidos', async (req, res) => {
    try {
        res.json(await consultarPedidos());
    } catch (error) {
        console.error('Error en GET /api/pedidos:', error);
        res.status(500).json({ mensaje: 'Error al obtener pedidos' });
    }
});

// Pedidos de un cliente
app.get('/api/pedidos/cliente/:id', async (req, res) => {
    try {
        res.json(await consultarPedidos('WHERE p.id_cliente = ?', [req.params.id]));
    } catch (error) {
        console.error('Error en GET /api/pedidos/cliente/:id:', error);
        res.status(500).json({ mensaje: 'Error al obtener tus pedidos' });
    }
});

// Pedidos de una sucursal
app.get('/api/pedidos/sucursal/:id', async (req, res) => {
    try {
        res.json(await consultarPedidos('WHERE p.sucursal_id = ?', [req.params.id]));
    } catch (error) {
        console.error('Error en GET /api/pedidos/sucursal/:id:', error);
        res.status(500).json({ mensaje: 'Error al obtener pedidos de la sucursal' });
    }
});

// Crear pedido: calcula precios desde la BD, valida y descuenta stock en una transacción
app.post('/api/pedidos', async (req, res) => {
    const {
        clienteId, sucursalId, sucursalNombre, items, costoEnvio,
        metodoEntrega, direccionEntrega, metodoPago, notasEspeciales, fechaEntregaEstimada
    } = req.body;

    if (!clienteId || !sucursalId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ mensaje: 'Faltan datos del pedido (cliente, sucursal o productos).' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Productos reales de la BD (bloqueados mientras se arma el pedido)
        const idsProductos = [...new Set(items.map((i) => i.productoId))];
        const [productos] = await conn.query(
            'SELECT id, nombre, precio, stock FROM productos WHERE id IN (?) FOR UPDATE',
            [idsProductos]
        );
        const mapa = new Map(productos.map((p) => [p.id, p]));

        // 2. Validar stock y calcular subtotal con precios de la BD
        let subtotal = 0;
        const lineas = [];
        for (const it of items) {
            const prod = mapa.get(it.productoId);
            const cant = Math.floor(Number(it.cantidad));
            if (!prod || !(cant > 0)) throw new ErrorNegocio('Hay un producto inválido en el pedido.');
            if (cant > prod.stock) {
                throw new ErrorNegocio(`No hay stock suficiente de "${prod.nombre}" (disponibles: ${prod.stock}).`);
            }
            prod.stock -= cant; // por si el mismo producto viene en dos líneas
            const precio = Number(prod.precio);
            subtotal += precio * cant;
            lineas.push({ idProducto: prod.id, cantidad: cant, precio, notas: it.notas || null });
        }

        subtotal = Math.round(subtotal * 100) / 100;
        const entrega = METODOS_ENTREGA.includes(metodoEntrega) ? metodoEntrega : 'Sucursal';
        const envio = entrega === 'Domicilio' ? Math.max(0, Number(costoEnvio) || 0) : 0;
        const total = Math.round((subtotal + envio) * 100) / 100;
        const idLista = 'LST-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // 3. Encabezado del pedido
        const [resultado] = await conn.query(
            `INSERT INTO pedidos
               (id_cliente, id_lista, fecha_pedido, sucursal_id, sucursal_nombre, fecha_entrega_estimada,
                subtotal, costo_envio, total, metodo_entrega, direccion_entrega, metodo_pago, estado, notas_especiales)
             VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?)`,
            [
                clienteId, idLista, sucursalId, sucursalNombre || '',
                fechaEntregaEstimada ? new Date(fechaEntregaEstimada) : null,
                subtotal, envio, total, entrega, direccionEntrega || null,
                metodoPago || 'Efectivo en Entrega', notasEspeciales || null
            ]
        );

        // 4. Productos del pedido + descuento de stock
        for (const l of lineas) {
            await conn.query(
                'INSERT INTO lista_productos (id_lista, id_producto, cantidad, precio_unitario, notas) VALUES (?, ?, ?, ?, ?)',
                [idLista, l.idProducto, l.cantidad, l.precio, l.notas]
            );
            await conn.query('UPDATE productos SET stock = stock - ? WHERE id = ?', [l.cantidad, l.idProducto]);
        }

        await conn.commit();

        const [pedido] = await consultarPedidos('WHERE p.id_pedido = ?', [resultado.insertId]);
        res.status(201).json(pedido);
    } catch (error) {
        await conn.rollback();
        if (error instanceof ErrorNegocio) {
            return res.status(400).json({ mensaje: error.message });
        }
        console.error('Error en POST /api/pedidos:', error);
        res.status(500).json({ mensaje: 'Error al registrar el pedido' });
    } finally {
        conn.release();
    }
});

// Cambiar estado (Trabajador / Admin). Al cancelar, el stock regresa al inventario.
app.patch('/api/pedidos/:id/estado', async (req, res) => {
    const idNum = parseInt(String(req.params.id).replace(/\D/g, ''), 10);
    const { estado } = req.body;

    if (!idNum || !ESTADOS_PEDIDO.includes(estado)) {
        return res.status(400).json({ mensaje: 'Pedido o estado inválido.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [filas] = await conn.query(
            'SELECT estado, id_lista FROM pedidos WHERE id_pedido = ? FOR UPDATE',
            [idNum]
        );
        if (filas.length === 0) {
            await conn.rollback();
            return res.status(404).json({ mensaje: 'Pedido no encontrado.' });
        }

        const { estado: previo, id_lista: idLista } = filas[0];
        if (previo === 'Cancelado' && estado !== 'Cancelado') {
            await conn.rollback();
            return res.status(400).json({ mensaje: 'Un pedido cancelado no se puede reactivar.' });
        }

        await conn.query('UPDATE pedidos SET estado = ? WHERE id_pedido = ?', [estado, idNum]);

        if (estado === 'Cancelado' && previo !== 'Cancelado') {
            const [lineas] = await conn.query(
                'SELECT id_producto, cantidad FROM lista_productos WHERE id_lista = ?',
                [idLista]
            );
            for (const l of lineas) {
                await conn.query('UPDATE productos SET stock = stock + ? WHERE id = ?', [l.cantidad, l.id_producto]);
            }
        }

        await conn.commit();

        const [pedido] = await consultarPedidos('WHERE p.id_pedido = ?', [idNum]);
        res.json(pedido);
    } catch (error) {
        await conn.rollback();
        console.error('Error en PATCH /api/pedidos/:id/estado:', error);
        res.status(500).json({ mensaje: 'Error al actualizar el estado del pedido' });
    } finally {
        conn.release();
    }
});

// Arrancar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend escuchando en http://localhost:${PORT}`);
});